import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mergeRoomCaptions, signCallRef } from '@/lib/call';
import { callCaptions, callHush } from '@/lib/call-server';
import { ctxForCall, verifyCtx } from '@/lib/live-agents';
import { BARGE_DEFAULTS, BARGE_START, bargeConfig, bargeStep, type BargeState } from '@/lib/barge-in';

// The hush route: a signed-in owner, everything else real.
const user = { id: 'u1' };
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
  }),
}));

beforeAll(() => {
  process.env.SLATES_ENC_KEY ??= randomBytes(32).toString('base64');
});

const SECRET = 'room-secret';
const ENV = { AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32), MURF_API_KEY: 'murf-test' };
const LIVE_ENV = { ...ENV, RUNNER_URL: 'https://runner.example.com', ASK_SECRET: SECRET };
const CAST = [
  { agentId: 'ag-claude', uid: 2001 },
  { agentId: 'ag-codex', uid: 2002 },
];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const STATE = {
  transcript: [
    { kind: 'human', who: 'You', text: 'Claude, why did it fail?', at: 1 },
    { kind: 'agent', who: 'Claude', text: 'A missing env var.', at: 2 },
  ],
  floor: { who: 'You', since: 3 },
  status: { Claude: 'idle', Codex: 'thinking' },
};
const refFor = (cast = CAST) => signCallRef({ agentId: 'host-1', slatesAgentId: 'sa1', channel: 'slates-room', userId: 'u1', cast });

/** Agora + runner mock: records each call (url, method, auth, body). */
function fakeNet(history: unknown = { contents: [] }) {
  const calls: { url: string; method: string; auth: string; body: any }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', auth: String((init.headers as any)?.authorization ?? ''), body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.includes('/interrupt')) return json(200, {});
    if (url.endsWith('/history')) return json(200, history);
    if (url.startsWith('https://runner.example.com/room/hush')) return json(200, { ok: true, interrupted: ['Claude'], state: STATE });
    if (url.startsWith('https://runner.example.com/room/')) return json(200, { ok: true, state: STATE });
    return json(404, {});
  });
  return { f, calls };
}

describe('hush', () => {
  it('interrupts Slates on Agora and forwards to the runner with a valid ctx, the bearer secret and the heard live uids', async () => {
    const { f, calls } = fakeNet();
    const out = await callHush({ sb: {} as any, fetch: f as any, env: LIVE_ENV }, 'u1', refFor(), [2001, 1000, 9999, 'x']);
    expect(out).toEqual({ ok: true, host: true, interrupted: ['Claude'], room: { floor: STATE.floor, status: STATE.status } });
    const host = calls.find((c) => c.url.includes('/interrupt'))!;
    expect(host.url).toBe(`https://api.agora.io/api/conversational-ai-agent/v2/projects/${ENV.AGORA_APP_ID}/agents/host-1/interrupt`);
    expect(host.auth).toMatch(/^agora token="007/);
    const room = calls.find((c) => c.url.includes('/room/hush'))!;
    expect(room.method).toBe('POST');
    expect(room.auth).toBe(`Bearer ${SECRET}`);
    expect(room.body.uids).toEqual([2001]);
    expect(verifyCtx(SECRET, room.body.ctx)).toMatchObject({ channel: 'slates-room', cast: { Claude: { agentId: 'ag-claude', uid: 2001 }, Codex: { agentId: 'ag-codex', uid: 2002 } } });
  });

  it('without live agents or a runner it only interrupts Slates; a stranger’s call is refused', async () => {
    const { f, calls } = fakeNet();
    await expect(callHush({ sb: {} as any, fetch: f as any, env: ENV }, 'u1', refFor())).resolves.toEqual({ ok: true, host: true, interrupted: [] });
    expect(calls.some((c) => c.url.includes('/room/'))).toBe(false);
    await expect(callHush({ sb: {} as any, fetch: f as any, env: LIVE_ENV }, 'someone-else', refFor())).rejects.toMatchObject({ status: 403 });
  });

  it('the route: same-origin only, needs a callRef, and forwards to the runner', async () => {
    const { f, calls } = fakeNet();
    const realFetch = globalThis.fetch;
    const realEnv = { ...process.env };
    Object.assign(process.env, LIVE_ENV);
    globalThis.fetch = f as any;
    try {
      const { POST } = await import('@/app/api/call/hush/route');
      const req = (body: unknown, origin = 'http://localhost:3100') =>
        new Request('http://localhost:3100/api/call/hush', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect((await POST(req({ callRef: refFor() }, 'https://evil.example.com'))).status).toBe(403);
      expect((await POST(req({}))).status).toBe(400);
      const r = await POST(req({ callRef: refFor(), uids: [2002] }));
      expect(r.status).toBe(200);
      expect((await r.json()).interrupted).toEqual(['Claude']);
      const room = calls.find((c) => c.url.includes('/room/hush'))!;
      expect(verifyCtx(SECRET, room.body.ctx)?.channel).toBe('slates-room');
      expect(room.body.uids).toEqual([2002]);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of Object.keys(LIVE_ENV)) if (!(k in realEnv)) delete process.env[k];
      Object.assign(process.env, realEnv);
    }
  });
});

describe('captions with the meeting room', () => {
  it('sends the host history to the runner and weaves the agents’ lines in, with their statuses', async () => {
    const { f, calls } = fakeNet({
      contents: [
        { role: 'assistant', content: "Hi, it's Slates." },
        { role: 'user', content: 'Claude, why did it fail?' },
      ],
    });
    const out = await callCaptions({ sb: {} as any, fetch: f as any, env: LIVE_ENV }, 'u1', refFor());
    expect(out.captions).toEqual([
      { who: 'Slates', text: "Hi, it's Slates." },
      { who: 'You', text: 'Claude, why did it fail?' },
      { who: 'Claude', text: 'A missing env var.' },
    ]);
    expect(out.room).toEqual({ floor: STATE.floor, status: STATE.status });
    const ev = calls.find((c) => c.url.endsWith('/room/event'))!;
    expect(ev.body.history).toEqual([
      { who: 'Slates', text: "Hi, it's Slates." },
      { who: 'You', text: 'Claude, why did it fail?' },
    ]);
    expect(ev.body.host).toEqual({ agentId: 'host-1' });
  });

  it('runner away: plain host captions, no room', async () => {
    const f = vi.fn(async (url: string) => (url.endsWith('/history') ? json(200, { contents: [{ role: 'assistant', content: 'Hi' }] }) : json(502, {})));
    await expect(callCaptions({ sb: {} as any, fetch: f as any, env: LIVE_ENV }, 'u1', refFor())).resolves.toEqual({ captions: [{ who: 'Slates', text: 'Hi' }], ended: false });
  });

  it('ctxForCall names the live voices by uid', () => {
    const ctx = ctxForCall(SECRET, 'ch', [{ agentId: 'x', uid: 2003 }, { agentId: 'y', uid: 2999 }]);
    expect(verifyCtx(SECRET, ctx)?.cast).toEqual({ Antigravity: { agentId: 'x', uid: 2003 } });
  });
});

describe('mergeRoomCaptions', () => {
  const base = [
    { who: 'Slates', text: 'Hi.' },
    { who: 'You', text: 'Claude, status?' },
    { who: 'Slates', text: 'Asking Claude' },
    { who: 'You', text: 'Codex?' },
    { who: 'Slates', text: 'Asking Claude' },
  ];
  it('puts each agent line after the line it followed; repeated lines match from the end; notes are skipped', () => {
    const room = [
      { kind: 'host', who: 'Slates', text: 'Hi.' },
      { kind: 'human', who: 'You', text: 'Claude, status?' },
      { kind: 'host', who: 'Slates', text: 'Asking Claude' },
      { kind: 'agent', who: 'Claude', text: 'All green.' },
      { kind: 'note', who: 'Claude', text: '[Claude was interrupted by Codex]' },
      { kind: 'agent', who: 'Codex', text: 'One test is flaky.' },
      { kind: 'human', who: 'You', text: 'Codex?' },
      { kind: 'host', who: 'Slates', text: 'Asking Claude' },
      { kind: 'agent', who: 'Claude', text: 'Agreed.' },
    ];
    expect(mergeRoomCaptions(base, room).map((c) => `${c.who}: ${c.text}`)).toEqual([
      'Slates: Hi.',
      'You: Claude, status?',
      'Slates: Asking Claude',
      'Claude: All green.',
      'Codex: One test is flaky.',
      'You: Codex?',
      'Slates: Asking Claude',
      'Claude: Agreed.',
    ]);
  });
  it('no room or no agent lines: the base is unchanged; agent lines newer than the window go at the end', () => {
    expect(mergeRoomCaptions(base, null)).toBe(base);
    expect(mergeRoomCaptions(base, [{ kind: 'human', who: 'You', text: 'x' }])).toBe(base);
    const out = mergeRoomCaptions(base.slice(0, 2), [
      { kind: 'human', who: 'You', text: 'Claude, status?' },
      { kind: 'human', who: 'You', text: 'not in the window yet' },
      { kind: 'agent', who: 'Codex', text: 'Fresh.' },
    ]);
    expect(out.at(-1)).toEqual({ who: 'Codex', text: 'Fresh.' });
  });
});

describe('barge-in', () => {
  const run = (ticks: { level: number; agentSpeaking?: boolean; muted?: boolean; now: number }[]) => {
    let s: BargeState = BARGE_START;
    const fired: number[] = [];
    for (const t of ticks) {
      const r = bargeStep(s, { agentSpeaking: true, muted: false, ...t });
      s = r.state;
      if (r.fire) fired.push(t.now);
    }
    return fired;
  };
  it('fires once your level stays above 0.08 for 250 ms while an agent talks', () => {
    expect(run([{ level: 0.1, now: 0 }, { level: 0.1, now: 150 }, { level: 0.1, now: 300 }])).toEqual([300]);
    expect(BARGE_DEFAULTS).toMatchObject({ level: 0.08, holdMs: 250 });
  });
  it('a dip below the threshold restarts the run; quiet, muted or nobody talking never fires', () => {
    expect(run([{ level: 0.1, now: 0 }, { level: 0.02, now: 150 }, { level: 0.1, now: 300 }, { level: 0.1, now: 450 }])).toEqual([]);
    expect(run([{ level: 0.07, now: 0 }, { level: 0.07, now: 300 }])).toEqual([]);
    expect(run([{ level: 0.5, now: 0, muted: true }, { level: 0.5, now: 400, muted: true }])).toEqual([]);
    expect(run([{ level: 0.5, now: 0, agentSpeaking: false }, { level: 0.5, now: 400, agentSpeaking: false }])).toEqual([]);
  });
  it('then waits out a cooldown before firing again', () => {
    const ticks = Array.from({ length: 20 }, (_, i) => ({ level: 0.2, now: i * 150 }));
    expect(run(ticks)).toEqual([300, 1800]);
  });
  it('the level and hold are configurable within sane bounds', () => {
    expect(bargeConfig('0.12', '400')).toMatchObject({ level: 0.12, holdMs: 400 });
    expect(bargeConfig('7', '5')).toMatchObject({ level: 0.08, holdMs: 250 });
    expect(bargeConfig(undefined, '')).toMatchObject({ level: 0.08, holdMs: 250 });
  });
});
