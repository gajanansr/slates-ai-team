import { createHmac, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { greetingFor, joinBody, verifyCallRef } from '@/lib/call';
import { startCall } from '@/lib/call-server';
import { CTX_TTL_S, askAgentTool, liveConfig, liveSystem, signCtx, verifyCtx } from '@/lib/live-agents';
import { NOBODY_UID } from '@/lib/standup';

beforeAll(() => {
  process.env.SLATES_ENC_KEY ??= randomBytes(32).toString('base64');
});

const SECRET = 'ask-secret-test';
const RUNNER = 'https://runner.example.com/';
const ENV = { AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32), MURF_API_KEY: 'murf-test' };
const LIVE_ENV = { ...ENV, RUNNER_URL: RUNNER, ASK_SECRET: SECRET };
const cfg = { appId: ENV.AGORA_APP_ID, cert: ENV.AGORA_APP_CERTIFICATE, murfKey: ENV.MURF_API_KEY };
const NOW = Date.parse('2026-11-21T12:00:00Z');
const CAST = [
  { name: 'Claude' as const, uid: 2001, agentId: 'ag-claude' },
  { name: 'Antigravity' as const, uid: 2003, agentId: 'ag-anti' },
];

describe('liveConfig', () => {
  it('needs both RUNNER_URL and ASK_SECRET, https (or localhost), and trims the trailing slash', () => {
    expect(liveConfig(LIVE_ENV)).toEqual({ runnerUrl: 'https://runner.example.com', secret: SECRET });
    expect(liveConfig({ ...LIVE_ENV, RUNNER_URL: '' })).toBeNull();
    expect(liveConfig({ ...LIVE_ENV, ASK_SECRET: ' ' })).toBeNull();
    expect(liveConfig({ ...LIVE_ENV, RUNNER_URL: 'http://evil.example.com' })).toBeNull();
    expect(liveConfig({ ...LIVE_ENV, RUNNER_URL: 'not a url' })).toBeNull();
    expect(liveConfig({ ...LIVE_ENV, RUNNER_URL: 'http://localhost:8787' })?.runnerUrl).toBe('http://localhost:8787');
  });
});

describe('CTX', () => {
  it('is base64url(JSON) "." base64url(HMAC-SHA256(secret, base64url(JSON))) with channel, joined cast and exp = now + 2h', () => {
    const ctx = signCtx(SECRET, { channel: 'slates-x', cast: CAST }, NOW);
    const [body, sig, ...rest] = ctx.split('.');
    expect(rest).toEqual([]);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sig).toBe(createHmac('sha256', SECRET).update(body).digest('base64url'));
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({
      channel: 'slates-x',
      cast: { Claude: { agentId: 'ag-claude', uid: 2001 }, Antigravity: { agentId: 'ag-anti', uid: 2003 } },
      exp: NOW / 1000 + CTX_TTL_S,
    });
    expect(CTX_TTL_S).toBe(7200);
    expect(verifyCtx(SECRET, ctx, NOW)?.cast.Codex).toBeUndefined();
  });

  it('rejects tampering, the wrong secret, junk and expiry', () => {
    const ctx = signCtx(SECRET, { channel: 'slates-x', cast: CAST }, NOW);
    expect(verifyCtx(SECRET, ctx, NOW)).toMatchObject({ channel: 'slates-x' });
    const [body, sig] = ctx.split('.');
    const forged = Buffer.from(JSON.stringify({ channel: 'slates-y', cast: {}, exp: NOW / 1000 + 99 })).toString('base64url');
    expect(verifyCtx(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyCtx(SECRET, `${body}.${sig.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(verifyCtx('other-secret', ctx, NOW)).toBeNull();
    expect(verifyCtx(SECRET, `${ctx}.x`, NOW)).toBeNull();
    expect(verifyCtx(SECRET, 'junk', NOW)).toBeNull();
    expect(verifyCtx(SECRET, 42, NOW)).toBeNull();
    expect(verifyCtx(SECRET, ctx, NOW + CTX_TTL_S * 1000)).toBeNull();
  });
});

describe('ask_agent tool', () => {
  const live = liveConfig(LIVE_ENV)!;
  const tool = askAgentTool(live, 'CTX.SIG', ['Claude', 'Antigravity']);

  it('matches the Agora custom tool format: sync, POST to the runner, bearer secret, one placeholder per body leaf', () => {
    expect(tool.type).toBe('function');
    expect(tool.function.name).toBe('ask_agent');
    expect(tool.function.parameters).toEqual({
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['Claude', 'Antigravity'] },
        question: { type: 'string', description: "The user's question, self-contained" },
      },
      required: ['agent', 'question'],
    });
    expect(tool.execution).toEqual({ mode: 'sync' });
    expect(tool.server).toEqual({
      method: 'POST',
      url: 'https://runner.example.com/ask',
      headers: { Authorization: `Bearer ${SECRET}` },
      body: { agent: '{{args.agent}}', question: '{{args.question}}', ctx: 'CTX.SIG', tool_call_id: '{{tool_call_id}}' },
      timeout_ms: 90000,
    });
    for (const v of Object.values(tool.server.body)) expect(v.includes('{{') ? /^\{\{[a-z_.]+\}\}$/.test(v) : true, v).toBe(true);
  });

  it('with all three live, the description is the spec text', () => {
    expect(askAgentTool(live, 'c', ['Claude', 'Codex', 'Antigravity']).function.description).toBe(
      "Ask one of the user's live agents (Claude, Codex, Antigravity) a question; they hear the meeting so far and answer aloud in their own voice in this call. Call it right away when the user addresses one of them by name or asks for their opinion; for \"everyone\" or \"the team\", ask the most relevant one (the others may jump in on their own). Say 'Asking <name>' first; when the result has spoken=true, stay quiet: don't repeat or sum up their answer.",
    );
  });

  it('the host body carries it next to the MCP tools, with tools enabled; no tools means no key', () => {
    const body = joinBody(cfg, { channel: 'c', hostToken: 'H', slatesToken: 'S', greeting: 'hi', tools: [tool] });
    expect(body.properties.advanced_features.enable_tools).toBe(true);
    expect(body.properties.llm.tools).toEqual([tool]);
    expect(body.properties.llm.mcp_servers).toHaveLength(1);
    expect('tools' in joinBody(cfg, { channel: 'c', hostToken: 'H', slatesToken: 'S', greeting: 'hi' }).properties.llm).toBe(false);
  });

  it('host instructions: spoken=true not repeated, relay when false, hand_off for the rest', () => {
    const sys = liveSystem(['Claude', 'Codex'], ['Gemini', 'Claude Code', 'Instinct']);
    expect(sys).toContain('Live on this call: Claude and Codex.');
    expect(sys).toContain('spoken true');
    expect(sys).toContain('Codex says');
    expect(sys).toContain('Gemini and Instinct are not on this call');
    expect(sys).not.toContain('Claude Code');
  });

  it('host instructions: Slates moderates; named agent asked at once; "everyone" goes to the most relevant one', () => {
    const sys = liveSystem(['Claude', 'Codex'], []);
    expect(sys).toContain('host and moderator of this meeting, not the main speaker');
    expect(sys).toContain('call ask_agent immediately');
    expect(sys).toContain('stay quiet while they answer');
    expect(sys).toContain('addresses everyone or the team, ask the single most relevant live agent first');
    expect(liveSystem(['Codex'], [])).not.toContain('everyone or the team');
  });

  it('greets naming who is live', () => {
    expect(greetingFor('Ada', ['Claude', 'Codex'])).toBe("Hi Ada, it's Slates. Claude and Codex are on the line too. What can I do for you?");
    expect(greetingFor('Ada', ['Codex'])).toBe("Hi Ada, it's Slates. Codex is on the line too. What can I do for you?");
  });
});

// ------------------------------------------------------------------ startCall with mocked Agora

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const activity = [
  { id: 1, agent_id: 'g', agent_name: 'Gemini', slate_id: 's', slate_slug: 'research', action: 'updated', summary: 'Finished the market research', created_at: ago(1) },
  { id: 2, agent_id: 'i', agent_name: 'Instinct', slate_id: 's', slate_slug: 'jobs', action: 'updated', summary: 'Applied to three jobs', created_at: ago(2) },
];

function fakeSb() {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'create_agent') return { data: { token: 'slt_percall', agent: { id: 'sa1' } }, error: null };
    if (fn === 'slates_exec' && args.p_op === 'activity') return { data: activity, error: null };
    return { data: [], error: null };
  });
  const query: any = { select: () => query, eq: () => query, is: () => query, lt: () => query, limit: async () => ({ data: [], error: null }) };
  return { sb: { rpc, from: () => query } as any, rpc };
}

/** Agora mock: casts get ag-<uid>; `failUid` refuses one voice; records every /join in order. */
function fakeAgora(failUid?: string) {
  const joins: any[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/join')) {
      const body = JSON.parse(init.body as string);
      joins.push(body);
      const uid = body.properties.agent_rtc_uid;
      if (uid === failUid) return res(503, { reason: 'busy' });
      return res(200, { agent_id: uid === '1000' ? 'host1' : `ag-${uid}`, status: 'RUNNING' });
    }
    return res(200, {});
  });
  return { fetch, joins };
}

const hostOf = (joins: any[]) => joins.find((j) => j.properties.agent_rtc_uid === '1000');

describe('startCall with live agents', () => {
  it('joins the live voices before the host, speak-only, and gives the host ask_agent for those that joined', async () => {
    const { sb } = fakeSb();
    const { fetch, joins } = fakeAgora('2002'); // Codex's voice fails to join
    const out = await startCall({ sb, fetch: fetch as any, env: { ...LIVE_ENV, GEMINI_API_KEY: 'g-key' }, now: () => NOW }, { id: 'u1', firstName: 'Ada' });

    // Order: every cast join is sent before the host's.
    expect(joins.map((j) => j.properties.agent_rtc_uid)).toEqual(['2001', '2002', '2003', '1000']);
    const casts = joins.slice(0, 3);
    expect(casts.map((c) => c.properties.tts.params.voiceId)).toEqual(['en-US-caleb', 'en-US-daniel', 'en-IN-aarav']);
    for (const c of casts) {
      expect(c.properties.remote_rtc_uids).toEqual([NOBODY_UID]);
      expect('mcp_servers' in c.properties.llm).toBe(false);
    }

    const host = hostOf(joins);
    // The host stays on Agora's managed model, even with a Gemini key around.
    expect(host.properties.llm).toMatchObject({ credential_mode: 'managed', vendor: 'openai', style: 'openai', params: { model: 'gpt-4.1-mini' } });
    expect(JSON.stringify(host)).not.toContain('g-key');
    const [tool] = host.properties.llm.tools;
    expect(host.properties.llm.tools).toHaveLength(1);
    expect(tool.function.parameters.properties.agent.enum).toEqual(['Claude', 'Antigravity']);
    expect(tool.server.url).toBe('https://runner.example.com/ask');
    expect(tool.server.headers).toEqual({ Authorization: `Bearer ${SECRET}` });
    const ctx = verifyCtx(SECRET, tool.server.body.ctx, NOW);
    expect(ctx).toEqual({
      channel: out.channel,
      cast: { Claude: { agentId: 'ag-2001', uid: 2001 }, Antigravity: { agentId: 'ag-2003', uid: 2003 } },
      exp: NOW / 1000 + 7200,
    });
    expect(host.properties.llm.greeting_message).toBe("Hi Ada, it's Slates. Claude and Antigravity are on the line too. What can I do for you?");
    const sys = host.properties.llm.system_messages[0].content;
    expect(sys).toContain('Live on this call: Claude and Antigravity.');
    expect(sys).toContain('Gemini and Instinct are not on this call');

    expect(out.participants.map((p) => [p.uid, p.name, !!p.live])).toEqual([
      [1000, 'Slates', false],
      [2001, 'Claude', true],
      [2003, 'Antigravity', true],
    ]);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(verifyCallRef(out.callRef)?.cast).toEqual([
      { agentId: 'ag-2001', uid: 2001 },
      { agentId: 'ag-2003', uid: 2003 },
    ]);
  });

  it('without RUNNER_URL: no voices join and the host has no ask_agent tool', async () => {
    const { sb } = fakeSb();
    const { fetch, joins } = fakeAgora();
    const out = await startCall({ sb, fetch: fetch as any, env: { ...ENV, ASK_SECRET: SECRET }, now: () => NOW }, { id: 'u1', firstName: 'Ada' });
    expect(joins.map((j) => j.properties.agent_rtc_uid)).toEqual(['1000']);
    expect('tools' in joins[0].properties.llm).toBe(false);
    expect(joins[0].properties.llm.greeting_message).toBe("Hi Ada, it's Slates. What can I do for you?");
    expect(out.participants).toEqual([{ uid: 1000, name: 'Slates', line: 'Your assistant' }]);
    expect(verifyCallRef(out.callRef)?.cast).toBeUndefined();
  });

  it('every voice failing: the call still starts, just without live agents', async () => {
    const { sb } = fakeSb();
    const joins: any[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      joins.push(body);
      return body.properties.agent_rtc_uid === '1000' ? res(200, { agent_id: 'host1' }) : res(500, {});
    });
    const out = await startCall({ sb, fetch: fetch as any, env: LIVE_ENV, now: () => NOW }, { id: 'u1', firstName: null });
    expect('tools' in hostOf(joins).properties.llm).toBe(false);
    expect(out.participants).toHaveLength(1);
  });

  it('host refuses: the live voices that joined leave again', async () => {
    const { sb, rpc } = fakeSb();
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (!url.endsWith('/join')) return res(200, {});
      const uid = JSON.parse(init.body as string).properties.agent_rtc_uid;
      return uid === '1000' ? res(400, {}) : res(200, { agent_id: `ag-${uid}` });
    });
    await expect(startCall({ sb, fetch: fetch as any, env: LIVE_ENV, now: () => NOW }, { id: 'u1', firstName: null })).rejects.toMatchObject({ status: 502 });
    const leaves = fetch.mock.calls.map(([u]) => u).filter((u) => u.endsWith('/leave')).map((u) => u.replace(/^.*\/agents\//, ''));
    expect(leaves.sort()).toEqual(['ag-2001/leave', 'ag-2002/leave', 'ag-2003/leave']);
    expect(rpc).toHaveBeenCalledWith('revoke_agent', { p_id: 'sa1' });
  });
});

describe('startCall standup (honest)', () => {
  it('no voices for agents that are not live: the host narrates every update, orders go to hand_off', async () => {
    const { sb } = fakeSb();
    const { fetch, joins } = fakeAgora();
    const llm = vi.fn(async () => null);
    const out = await startCall({ sb, fetch: fetch as any, env: LIVE_ENV, now: () => NOW, llm }, { id: 'u1', firstName: 'Ada' }, { mode: 'standup' });

    // Only the live voices and the host join: Gemini and Instinct get no voice.
    expect(joins.map((j) => j.properties.agent_rtc_uid)).toEqual(['2001', '2002', '2003', '1000']);
    const ref = verifyCallRef(out.callRef)!;
    expect(ref.standup!.script.every((l) => l.uid === 1000 && l.who === 'Slates')).toBe(true);
    expect(ref.standup!.script.map((l) => l.text)).toEqual([
      "Gemini finished the market research. It's on your research board.",
      "Instinct applied to three jobs. It's on your jobs board.",
      "That's everyone. Claude, Codex and Antigravity are on the call if you want to ask them anything. What should the team do next?",
    ]);
    expect(out.standup!.order).toEqual([1000, 1000, 1000]);
    expect(out.standup!.reports).toEqual([
      { name: 'Gemini', line: 'Finished the market research' },
      { name: 'Instinct', line: 'Applied to three jobs' },
    ]);
    expect(out.participants.map((p) => p.name)).toEqual(['Slates', 'Claude', 'Codex', 'Antigravity']);

    const host = hostOf(joins);
    expect(host.properties.llm.greeting_message).toBe("Hi Ada, it's standup time. Here's what your team did since yesterday.");
    const sys = host.properties.llm.system_messages[0].content;
    expect(sys).toContain('you are the only one who narrates');
    expect(sys).toContain('Gemini and Instinct are not on this call and only work through Slates');
    expect(sys).toContain('hand_off');
    expect(host.properties.llm.tools[0].function.parameters.properties.agent.enum).toEqual(['Claude', 'Codex', 'Antigravity']);
    expect(host.properties.parameters.silence_config.timeout_ms).toBe(0);
  });
});
