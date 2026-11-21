import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CALL_REF_TTL_MS, CALL_TOOLS, callConfig, greetingFor, joinBody, signCallRef, toCaptions, verifyCallRef } from '@/lib/call';
import { callCaptions, endCall, startCall } from '@/lib/call-server';
import { TOOL_BY_NAME } from '@/lib/agent/tools';

beforeAll(() => {
  process.env.SLATES_ENC_KEY ??= randomBytes(32).toString('base64');
});

const ENV = { AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32), MURF_API_KEY: 'murf-test' };
const cfg = { appId: ENV.AGORA_APP_ID, cert: ENV.AGORA_APP_CERTIFICATE, murfKey: ENV.MURF_API_KEY };

describe('join body', () => {
  const body = joinBody(cfg, { channel: 'slates-x', hostToken: 'HOST', slatesToken: 'slt_percall', greeting: greetingFor('Ada Lovelace') });

  it('enables tools and points the MCP server at Slates with the per-call token', () => {
    expect(body.properties.advanced_features.enable_tools).toBe(true);
    const [mcp] = body.properties.llm.mcp_servers;
    expect(mcp.headers.Authorization).toBe('Bearer slt_percall');
    expect(mcp.endpoint).toMatch(/\/mcp$/);
    expect(mcp.transport).toBe('streamable_http');
    expect(body.properties.token).toBe('HOST');
    expect(body.properties.agent_rtc_uid).toBe('1000');
    expect(body.properties.remote_rtc_uids).toEqual(['1001']);
    expect(body.properties.tts.params.api_key).toBe('murf-test');
  });

  it('allows only real, non-destructive tools, at most 32', () => {
    const allowed = body.properties.llm.mcp_servers[0].allowed_tools;
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.length).toBeLessThanOrEqual(32);
    for (const t of allowed) {
      expect(TOOL_BY_NAME.has(t), t).toBe(true);
      expect(t).not.toMatch(/archive|delete|restore|automation|cancel|reorder|update_slate|set_app_layout/);
    }
    expect(allowed).toEqual([...CALL_TOOLS]);
  });

  it('greets by first name, or plainly', () => {
    expect(body.properties.llm.greeting_message).toBe("Hi Ada, it's Slates. What can I do for you?");
    expect(greetingFor(null)).toBe("Hi, it's Slates. What can I do for you?");
    expect(greetingFor('  ')).toBe("Hi, it's Slates. What can I do for you?");
  });

  it('needs every env var', () => {
    expect(callConfig(ENV)).toEqual(cfg);
    expect(callConfig({ ...ENV, MURF_API_KEY: '' })).toBeNull();
    expect(callConfig({ AGORA_APP_ID: 'x' })).toBeNull();
  });
});

describe('call reference', () => {
  const ref = { agentId: 'ag1', slatesAgentId: '11111111-1111-1111-1111-111111111111', channel: 'slates-abc', userId: 'u1' };

  it('round-trips', () => {
    const now = Date.now();
    expect(verifyCallRef(signCallRef(ref, now), now + 1000)).toEqual({ ...ref, exp: now + CALL_REF_TTL_MS });
  });

  it('rejects tampering', () => {
    const s = signCallRef(ref);
    const parts = s.split('.');
    const body = Buffer.from(parts[2], 'base64url');
    body[0] ^= 1;
    parts[2] = body.toString('base64url');
    expect(verifyCallRef(parts.join('.'))).toBeNull();
    expect(verifyCallRef(s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1))).toBeNull();
    expect(verifyCallRef('v1.x.y.z')).toBeNull();
    expect(verifyCallRef(JSON.stringify({ ...ref, exp: Date.now() + 1e6 }))).toBeNull();
    expect(verifyCallRef(42)).toBeNull();
  });

  it('rejects expired references', () => {
    const now = Date.now();
    expect(verifyCallRef(signCallRef(ref, now), now + CALL_REF_TTL_MS + 1)).toBeNull();
  });
});

describe('captions', () => {
  it('maps history to who/text and drops junk', () => {
    expect(
      toCaptions({ contents: [{ role: 'assistant', content: 'Hi' }, { role: 'user', content: ' add milk ' }, { role: 'tool', content: 'x' }, { role: 'user', content: '' }] }),
    ).toEqual([
      { who: 'Slates', text: 'Hi' },
      { who: 'You', text: 'add milk' },
    ]);
    expect(toCaptions(null)).toEqual([]);
  });
});

// ------------------------------------------------------------------ handler logic with mocks

function fakeSb(opts: { createError?: { code: string; message: string }; revoked?: string | null; ownRow?: boolean } = {}) {
  const rpc = vi.fn(async (fn: string, _args: Record<string, unknown>) => {
    if (fn === 'create_agent') return opts.createError ? { data: null, error: opts.createError } : { data: { token: 'slt_percall', agent: { id: 'sa1' } }, error: null };
    if (fn === 'revoke_agent') return { data: null, error: null };
    return { data: null, error: null };
  });
  const query: any = {
    select: () => query,
    eq: () => query,
    is: () => query,
    lt: () => query,
    limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: opts.ownRow === false ? null : { id: 'sa1', revoked_at: opts.revoked ?? null }, error: null }),
  };
  return { sb: { rpc, from: () => query } as any, rpc };
}

const res = (status: number, body: unknown) => new Response(body === undefined ? '' : JSON.stringify(body), { status });

describe('startCall', () => {
  it('creates a per-call token, joins Agora with it, and returns only browser-safe fields', async () => {
    const { sb, rpc } = fakeSb();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => res(200, { agent_id: 'ag1', status: 'RUNNING' }));
    const out = await startCall({ sb, fetch: fetch as any, env: ENV }, { id: 'u1', firstName: 'Ada' });

    expect(rpc).toHaveBeenCalledWith('create_agent', { p_name: 'Slates Voice', p_kind: 'slates', p_scopes: ['read', 'write'], p_days: 1 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.agora.io/api/conversational-ai-agent/v2/projects/${ENV.AGORA_APP_ID}/join`);
    expect((init.headers as Record<string, string>).authorization).toMatch(/^agora token="/);
    const sent = JSON.parse(init.body as string);
    expect(sent.properties.llm.mcp_servers[0].headers.Authorization).toBe('Bearer slt_percall');

    expect(out.uid).toBe(1001);
    expect(out.appId).toBe(ENV.AGORA_APP_ID);
    expect(out.channel).toMatch(/^slates-[0-9a-f]{20}$/);
    expect(JSON.stringify(out)).not.toContain('slt_percall');
    expect(verifyCallRef(out.callRef)).toMatchObject({ agentId: 'ag1', slatesAgentId: 'sa1', userId: 'u1', channel: out.channel });
  });

  it('answers 503 when calling is not configured', async () => {
    const { sb, rpc } = fakeSb();
    await expect(startCall({ sb, env: {} }, { id: 'u1', firstName: null })).rejects.toMatchObject({ status: 503, message: "Calling isn't set up yet." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('revokes the token when Agora refuses', async () => {
    const { sb, rpc } = fakeSb();
    const fetch = vi.fn(async () => res(400, { reason: 'bad' }));
    await expect(startCall({ sb, fetch: fetch as any, env: ENV }, { id: 'u1', firstName: null })).rejects.toMatchObject({ status: 502 });
    expect(rpc).toHaveBeenCalledWith('revoke_agent', { p_id: 'sa1' });
  });
});

describe('endCall', () => {
  const ref = () => signCallRef({ agentId: 'ag1', slatesAgentId: 'sa1', channel: 'slates-abc', userId: 'u1' });

  it('makes the agent leave and revokes the token', async () => {
    const { sb, rpc } = fakeSb();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => res(200, {}));
    await expect(endCall({ sb, fetch: fetch as any, env: ENV }, 'u1', ref())).resolves.toEqual({ ok: true });
    expect(fetch.mock.calls[0][0]).toMatch(/\/agents\/ag1\/leave$/);
    expect(rpc).toHaveBeenCalledWith('revoke_agent', { p_id: 'sa1' });
  });

  it('is idempotent: agent gone and token already revoked is still ok', async () => {
    const { sb, rpc } = fakeSb({ revoked: new Date().toISOString() });
    const fetch = vi.fn(async () => res(404, { reason: 'not found' }));
    await expect(endCall({ sb, fetch: fetch as any, env: ENV }, 'u1', ref())).resolves.toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses someone else's call or a forged reference", async () => {
    const { sb } = fakeSb();
    const fetch = vi.fn(async () => res(200, {}));
    await expect(endCall({ sb, fetch: fetch as any, env: ENV }, 'u2', ref())).rejects.toMatchObject({ status: 403 });
    await expect(endCall({ sb, fetch: fetch as any, env: ENV }, 'u1', 'forged')).rejects.toMatchObject({ status: 400 });
    const notMine = fakeSb({ ownRow: false });
    await expect(endCall({ sb: notMine.sb, fetch: fetch as any, env: ENV }, 'u1', ref())).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('callCaptions', () => {
  it('proxies history and flags a finished agent', async () => {
    const { sb } = fakeSb();
    const ref = signCallRef({ agentId: 'ag1', slatesAgentId: 'sa1', channel: 'slates-abc', userId: 'u1' });
    const live = vi.fn(async () => res(200, { contents: [{ role: 'assistant', content: 'Hi' }] }));
    await expect(callCaptions({ sb, fetch: live as any, env: ENV }, 'u1', ref)).resolves.toEqual({ captions: [{ who: 'Slates', text: 'Hi' }], ended: false });
    const gone = vi.fn(async () => res(404, {}));
    await expect(callCaptions({ sb, fetch: gone as any, env: ENV }, 'u1', ref)).resolves.toEqual({ captions: [], ended: true });
  });
});
