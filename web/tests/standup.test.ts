import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mergeCaptions, signCallRef, verifyCallRef } from '@/lib/call';
import { endCall, standupNext, standupSince } from '@/lib/call-server';
import {
  CLOSING_QUESTION,
  DAY_MS,
  MAX_REPORTERS,
  NOBODY_UID,
  REPORT_WORDS,
  buildReports,
  castBody,
  clampWords,
  fitSpeech,
  gatherStandup,
  localeOf,
  parseReports,
  standupScript,
  standupSystem,
  templateReport,
} from '@/lib/standup';
import { LIVE_AGENTS } from '@/lib/live-agents';
import type { Activity } from '@/lib/slates';
import type { DeskItem } from '@/lib/desk';

beforeAll(() => {
  process.env.SLATES_ENC_KEY ??= randomBytes(32).toString('base64');
});

const ENV = { AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32), MURF_API_KEY: 'murf-test' };
const cfg = { appId: ENV.AGORA_APP_ID, cert: ENV.AGORA_APP_CERTIFICATE, murfKey: ENV.MURF_API_KEY };
const NOW = Date.parse('2026-11-21T12:00:00Z');
const SINCE = NOW - DAY_MS;
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

let n = 0;
const act = (agent: string | null, summary: string, h: number, slug = 'work'): Activity => ({
  id: ++n,
  agent_id: agent ? `id-${agent}` : null,
  agent_name: agent,
  slate_id: 's1',
  slate_slug: slug,
  action: 'updated',
  summary,
  created_at: ago(h),
});
const item = (type: DeskItem['type'], from: string, text: string, h: number, extra: Partial<DeskItem> = {}): DeskItem => ({
  id: `${type}-${++n}`,
  type,
  from,
  text,
  open: type !== 'session',
  at: ago(h),
  ...extra,
});

describe('gatherStandup', () => {
  const activity = [
    act('Claude', 'Fixed the login bug', 1),
    act('Claude Code', 'Updated the Website board', 2, 'site'),
    act('Claude', 'Fixed the login bug', 3),
    act('Gemini', 'Added 3 research links', 5, 'research'),
    act('ChatGPT', 'Drafted the launch email', 6),
    act('Instinct', 'Reviewed bugs', 7),
    act('Jarvis', 'Sorted the inbox', 8),
    act('Old Agent', 'Did something last week', 60),
    act(null, 'You edited Groceries', 1),
    act('Slates Voice', 'Added milk', 1),
    act('Slates', 'Filed the inbox', 1),
    act('Claude', 'Claude: handled a desk item', 1, 'desk'),
  ];
  const desk = [
    item('session', 'Gemini', 'Researched flights to Lisbon', 4, { context: 'Hotel prices still missing' }),
    item('session', 'Gemini', 'An older closing note', 30),
    item('handoff', 'Claude', 'Deploy the site', 2, { to: 'Gemini' }),
    item('question', 'ChatGPT', 'Send the email today or Monday?', 3),
    item('question', 'Nobody Here', 'Old question', 40),
  ];
  const titles = { work: 'Work', site: 'Website', research: 'Research' };
  const data = gatherStandup({ activity, desk, titles, since: SINCE, now: NOW });

  it('groups by agent, keeps the window, skips the user and the host, caps at 4', () => {
    expect(data.agents.length).toBe(MAX_REPORTERS);
    const names = data.agents.map((a) => a.name);
    expect(names).not.toContain('Old Agent');
    expect(names).not.toContain('Slates Voice');
    expect(names).not.toContain('Slates');
    expect(names.some((x) => x === null || x === 'You')).toBe(false);
    // Agents with a closing note come first, then the most recent.
    expect(names[0]).toBe('Gemini');
    expect(names.slice(1)).toEqual(['Claude', 'Claude Code', 'ChatGPT']);
  });

  it('dedupes changes, maps board titles, ignores desk churn, attaches handoffs and asks', () => {
    const claude = data.agents.find((a) => a.name === 'Claude')!;
    expect(claude.changes).toEqual(['Fixed the login bug']);
    expect(claude.boards).toEqual(['Work']);
    expect(claude.handedOff).toEqual([{ to: 'Gemini', task: 'Deploy the site' }]);
    const gemini = data.agents.find((a) => a.name === 'Gemini')!;
    expect(gemini.session).toEqual({ did: 'Researched flights to Lisbon', open: 'Hotel prices still missing' });
    expect(gemini.handedTo).toEqual([{ from: 'Claude', task: 'Deploy the site' }]);
    expect(data.agents.find((a) => a.name === 'ChatGPT')!.asks).toEqual(['Send the email today or Monday?']);
    expect(data.waiting.map((w) => w.text)).toEqual(['Send the email today or Monday?', 'Old question']);
    expect(data.handoffs).toEqual([{ from: 'Claude', to: 'Gemini', task: 'Deploy the site' }]);
  });

  it('template narration is Slates speaking about the agent, at most 45 words', () => {
    for (const a of data.agents) {
      const r = templateReport(a);
      expect(words(r), r).toBeLessThanOrEqual(REPORT_WORDS);
      expect(r.length).toBeGreaterThan(10);
    }
    expect(templateReport(data.agents.find((a) => a.name === 'Claude')!)).toBe("Claude fixed the login bug. It's on your Work board. It handed deploy the site to Gemini.");
    expect(templateReport(data.agents[0])).toBe("Gemini wrapped up: researched flights to Lisbon. It's on your Research board. Still open: hotel prices still missing.");
    for (const a of data.agents) expect(templateReport(a)).not.toMatch(/\bI\b/);
  });

  it('nothing new: no reporters, and the script says so and still asks the closing question', async () => {
    const empty = gatherStandup({ activity: [act('Old Agent', 'x', 50)], desk: [], since: SINCE, now: NOW });
    expect(empty.agents).toEqual([]);
    const llm = vi.fn();
    expect(await buildReports(empty, llm)).toEqual({});
    expect(llm).not.toHaveBeenCalled();
    const { greeting, script } = standupScript({ firstName: 'Ada Lovelace', reports: [], waiting: [], since: SINCE, now: NOW });
    expect(greeting).toBe("Hi Ada, it's standup time. Nothing new from your agents since yesterday.");
    expect(script).toEqual([{ uid: 1000, who: 'Slates', text: CLOSING_QUESTION }]);
    expect(standupSystem(empty, {})).toContain('No agent had anything new to report.');
  });
});

describe('reports', () => {
  const data = gatherStandup({
    activity: [act('Claude', 'Fixed the login bug', 1), act('Gemini', 'Added links', 2)],
    desk: [],
    since: SINCE,
    now: NOW,
  });

  it('uses the LLM, clamps to 45 words, strips markdown, falls back per agent', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const llm = vi.fn(async (_system: string, _prompt: string) => `Here you go:\n{"claude": "**Claude fixed** the login bug. ${long}", "Gemini": "ok"}`);
    const out = await buildReports(data, llm);
    expect(llm).toHaveBeenCalledOnce();
    expect(llm.mock.calls[0][0]).toMatch(/third person/);
    expect(out.Claude.startsWith('Claude fixed the login bug.')).toBe(true);
    expect(out.Claude).not.toContain('*');
    expect(words(out.Claude)).toBeLessThanOrEqual(REPORT_WORDS);
    // Too short to be a report: the template speaks instead.
    expect(out.Gemini).toBe(templateReport(data.agents.find((a) => a.name === 'Gemini')!));
  });

  it('no LLM, a failing LLM, or junk all give template reports', async () => {
    const tpl = Object.fromEntries(data.agents.map((a) => [a.name, templateReport(a)]));
    expect(await buildReports(data)).toEqual(tpl);
    expect(await buildReports(data, async () => null)).toEqual(tpl);
    expect(await buildReports(data, async () => 'not json')).toEqual(tpl);
    expect(await buildReports(data, async () => { throw new Error('quota'); })).toEqual(tpl);
    expect(parseReports('["a"]', data.agents)).toEqual(tpl);
  });

  it('clampWords and fitSpeech keep spoken text short', () => {
    expect(clampWords('One. Two three.', 45)).toBe('One. Two three.');
    expect(words(clampWords('a '.repeat(100)))).toBeLessThanOrEqual(45);
    expect(clampWords('a '.repeat(100)).endsWith('.')).toBe(true);
    expect(Buffer.byteLength(fitSpeech('Hello there. '.repeat(80)))).toBeLessThanOrEqual(500);
  });
});

describe('cast agents', () => {
  it('never listen: remote uid 9999, own uid and token, same managed ASR/LLM, Murf voice + locale', () => {
    const b = castBody(cfg, { channel: 'slates-x', token: 'CAST', uid: 2002, voice: 'en-IN-aarav' });
    expect(b.properties.remote_rtc_uids).toEqual([NOBODY_UID]);
    expect(b.properties.remote_rtc_uids).not.toContain('1001');
    expect(b.properties.agent_rtc_uid).toBe('2002');
    expect(b.properties.token).toBe('CAST');
    expect(b.name).toBe('slates-x-2002');
    expect(b.properties.asr.credential_mode).toBe('managed');
    expect(b.properties.llm.credential_mode).toBe('managed');
    expect(b.properties.llm.system_messages[0].content).toBe('You only read out messages you are given.');
    expect('mcp_servers' in b.properties.llm).toBe(false);
    expect('greeting_message' in b.properties.llm).toBe(false);
    expect(b.properties.tts).toEqual({ vendor: 'murf', params: { api_key: 'murf-test', voiceId: 'en-IN-aarav', locale: 'en-IN', model: 'FALCON', sample_rate: 24000 } });
  });

  it('live voices: Claude caleb, Codex daniel, Antigravity aarav', () => {
    expect(LIVE_AGENTS.map((a) => [a.name, a.voice])).toEqual([
      ['Claude', 'en-US-caleb'],
      ['Codex', 'en-US-daniel'],
      ['Antigravity', 'en-IN-aarav'],
    ]);
    expect(localeOf('en-IN-aarav')).toBe('en-IN');
    expect(localeOf('weird')).toBe('en-US');
  });
});

describe('script', () => {
  const reports = [
    { name: 'Gemini', report: 'Gemini finished the market research.' },
    { name: 'Instinct', report: 'Instinct applied to three jobs.' },
  ];

  it('the host narrates every update in its own voice, then asks the closing question', () => {
    const { greeting, script } = standupScript({ firstName: null, reports, waiting: [{ from: 'ChatGPT', text: 'Send the email today?' }], since: NOW - 3 * 3600_000, now: NOW });
    expect(greeting).toBe("Hi, it's standup time. Here's what your team did since your last standup.");
    // No agent voices: every line is Slates (uid 1000).
    expect(script.map((l) => [l.uid, l.who, l.text])).toEqual([
      [1000, 'Slates', 'Gemini finished the market research.'],
      [1000, 'Slates', 'Instinct applied to three jobs.'],
      [1000, 'Slates', `That's everyone. One thing waits on you, like send the email today. ${CLOSING_QUESTION}`],
    ]);
  });

  it('names the live agents in the closing line', () => {
    const { script } = standupScript({ firstName: 'Ada', reports, live: ['Claude', 'Codex'], waiting: [], since: SINCE, now: NOW });
    expect(script.at(-1)!.text).toBe(`That's everyone. Claude and Codex are on the call if you want to ask them anything. ${CLOSING_QUESTION}`);
  });

  it('host system: narrated, honest about who is live, hand_off for the rest', () => {
    const data = gatherStandup({ activity: [act('Gemini', 'Finished the market research', 1), act('Instinct', 'Applied to three jobs', 2), act('Claude Code', 'Fixed CI', 3)], desk: [], since: SINCE, now: NOW });
    const sys = standupSystem(data, {}, ['Claude']);
    expect(sys).toContain('you are the only one who narrates');
    expect(sys).toContain('Live on this call: Claude.');
    expect(sys).toContain('Gemini and Instinct are not on this call and only work through Slates');
    expect(sys).toContain("I've left that for Instinct; it'll pick it up next time it runs.");
    expect(sys).toContain('hand_off');
    expect(sys).not.toContain('in their own voices');
    const none = standupSystem(data, {});
    expect(none).toContain('None of their agents is live on this call.');
    expect(none).not.toContain('ask_agent');
  });
});

// ------------------------------------------------------------------ call reference with a cast

const CAST = [
  { agentId: 'cast-claude', uid: 2001 },
  { agentId: 'cast-codex', uid: 2002 },
];
const STANDUP = {
  script: [
    { uid: 1000, who: 'Slates', text: 'Claude fixed the login bug.' },
    { uid: 1000, who: 'Slates', text: 'Gemini found three flights.' },
    { uid: 1000, who: 'Slates', text: CLOSING_QUESTION },
  ],
};
const base = { agentId: 'host1', slatesAgentId: 'sa1', channel: 'slates-abc', userId: 'u1' };

describe('standup call reference', () => {
  it('carries live cast ids and the narration', () => {
    const now = Date.now();
    expect(verifyCallRef(signCallRef({ ...base, cast: CAST, standup: STANDUP }, now), now + 1000)).toMatchObject({ ...base, cast: CAST, standup: STANDUP });
  });

  it('rejects tampering and malformed casts', () => {
    const s = signCallRef({ ...base, standup: STANDUP });
    const parts = s.split('.');
    const body = Buffer.from(parts[2], 'base64url');
    body[body.length - 3] ^= 1;
    parts[2] = body.toString('base64url');
    expect(verifyCallRef(parts.join('.'))).toBeNull();
    // Validly sealed but not a shape we issue: a scripted line in an agent's voice, a host uid in the cast.
    expect(verifyCallRef(signCallRef({ ...base, standup: { script: [{ uid: 2001, who: 'Claude', text: 'hi' }] } }))).toBeNull();
    expect(verifyCallRef(signCallRef({ ...base, cast: [{ agentId: 'x', uid: 1000 }] }))).toBeNull();
  });

  it('captions weave scripted lines in speaking order without duplicates', () => {
    const history = [
      { who: 'Slates', text: 'Hi Ada, standup time.' },
      { who: 'Slates', text: 'Gemini found three flights.' },
      { who: 'You', text: 'Ask Claude to deploy' },
    ];
    expect(mergeCaptions(history, STANDUP.script.slice(0, 2))).toEqual([
      { who: 'Slates', text: 'Hi Ada, standup time.' },
      { who: 'Slates', text: 'Claude fixed the login bug.' },
      { who: 'Slates', text: 'Gemini found three flights.' },
      { who: 'You', text: 'Ask Claude to deploy' },
    ]);
  });

  it('since: last standup when sane, else 24 h, never more than a week', () => {
    expect(standupSince(undefined, NOW)).toBe(NOW - DAY_MS);
    expect(standupSince('garbage', NOW)).toBe(NOW - DAY_MS);
    expect(standupSince(ago(-1), NOW)).toBe(NOW - DAY_MS);
    expect(standupSince(ago(3), NOW)).toBe(NOW - 3 * 3600_000);
    expect(standupSince(ago(24 * 30), NOW)).toBe(NOW - 7 * DAY_MS);
  });
});

// ------------------------------------------------------------------ /next and /end with mocked fetch

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function fakeSb(revoked: string | null = null) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'sa1', revoked_at: revoked }, error: null }) };
  return { sb: { rpc, from: () => query } as any, rpc };
}

describe('standupNext', () => {
  const ref = () => signCallRef({ ...base, standup: STANDUP });

  it('the host speaks every narrated line, in order, never a cast voice', async () => {
    const { sb } = fakeSb();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => res(200, {}));
    const deps = { sb, fetch: fetch as any, env: ENV };
    const out = [];
    const r = signCallRef({ ...base, cast: CAST, standup: STANDUP });
    for (let i = 0; i < STANDUP.script.length; i++) out.push(await standupNext(deps, 'u1', r, i));

    const calls = fetch.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).authorization }));
    expect(calls.map((c) => c.url.replace(/^.*\/agents\//, ''))).toEqual(['host1/speak', 'host1/speak', 'host1/speak']);
    expect(calls[0].url).toBe(`https://api.agora.io/api/conversational-ai-agent/v2/projects/${ENV.AGORA_APP_ID}/agents/host1/speak`);
    expect(calls.map((c) => c.body.text)).toEqual(STANDUP.script.map((l) => l.text));
    expect(calls.every((c) => c.body.priority === 'INTERRUPT')).toBe(true);
    // Narration can't be cut off; the closing question can (the user answers it).
    expect(calls.map((c) => c.body.interruptable)).toEqual([false, false, true]);
    expect(calls[0].auth).toMatch(/^agora token="/);
    expect(out.map((o) => o.uid)).toEqual([1000, 1000, 1000]);
    expect(out.map((o) => o.done)).toEqual([false, false, true]);
  });

  it('out-of-range or junk steps are a no-op', async () => {
    const { sb } = fakeSb();
    const fetch = vi.fn(async () => res(200, {}));
    const deps = { sb, fetch: fetch as any, env: ENV };
    for (const step of [-1, 3, 99, 1.5, '1', null]) {
      await expect(standupNext(deps, 'u1', ref(), step)).resolves.toMatchObject({ ok: true, uid: null, done: true });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a failed speak so the page can move on; refuses plain calls and other users', async () => {
    const { sb } = fakeSb();
    const fail = vi.fn(async () => res(404, { reason: 'gone' }));
    await expect(standupNext({ sb, fetch: fail as any, env: ENV }, 'u1', ref(), 0)).resolves.toMatchObject({ ok: false, uid: 1000 });
    const fetch = vi.fn(async () => res(200, {}));
    await expect(standupNext({ sb, fetch: fetch as any, env: ENV }, 'u1', signCallRef(base), 0)).rejects.toMatchObject({ status: 400 });
    await expect(standupNext({ sb, fetch: fetch as any, env: ENV }, 'u2', ref(), 0)).rejects.toMatchObject({ status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('endCall with live voices', () => {
  it('stops the host and every live voice, then revokes the token', async () => {
    const { sb, rpc } = fakeSb();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => res(200, {}));
    await expect(endCall({ sb, fetch: fetch as any, env: ENV }, 'u1', signCallRef({ ...base, cast: CAST, standup: STANDUP }))).resolves.toEqual({ ok: true });
    expect(fetch.mock.calls.map(([u]) => u.replace(/^.*\/agents\//, '')).sort()).toEqual(['cast-claude/leave', 'cast-codex/leave', 'host1/leave']);
    expect(rpc).toHaveBeenCalledWith('revoke_agent', { p_id: 'sa1' });
  });

  it('is idempotent: everyone already gone and the token revoked is still ok', async () => {
    const { sb, rpc } = fakeSb(new Date().toISOString());
    const fetch = vi.fn(async () => res(404, {}));
    await expect(endCall({ sb, fetch: fetch as any, env: ENV }, 'u1', signCallRef({ ...base, cast: CAST, standup: STANDUP }))).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(rpc).not.toHaveBeenCalled();
  });
});
