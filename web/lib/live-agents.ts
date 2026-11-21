import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Live agents: the user's real CLI agents (Claude, Codex, Antigravity) running on their own
 * laptop runner. In a call each one is a speak-only voice in the Agora channel; the host asks them
 * questions through the `ask_agent` tool, which posts to the runner's /ask. The runner runs the
 * agent and makes its voice say the answer, using the channel and cast ids sealed in CTX.
 *
 * Without RUNNER_URL and ASK_SECRET there are no live agents; everything else works.
 */

export const LIVE_AGENTS = [
  { name: 'Claude', voice: 'en-US-caleb' },
  { name: 'Codex', voice: 'en-US-daniel' },
  { name: 'Antigravity', voice: 'en-IN-aarav' },
] as const;
export type LiveName = (typeof LIVE_AGENTS)[number]['name'];
export const LIVE_NAMES: readonly LiveName[] = LIVE_AGENTS.map((a) => a.name);
/** Live voices take uids 2001, 2002, 2003 in LIVE_AGENTS order. */
export const LIVE_UID0 = 2001;
/** How long the runner accepts a call's CTX (seconds). */
export const CTX_TTL_S = 2 * 60 * 60;
export const ASK_TIMEOUT_MS = 90000;

export type LiveConfig = { runnerUrl: string; secret: string };
export type LiveCast = { name: LiveName; uid: number; agentId: string };

/** RUNNER_URL (https, or http on localhost) + ASK_SECRET, or null: then calls have no live agents. */
export function liveConfig(env: Record<string, string | undefined> = process.env): LiveConfig | null {
  const raw = env.RUNNER_URL?.trim();
  const secret = env.ASK_SECRET?.trim();
  if (!raw || !secret) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    return { runnerUrl: raw.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ CTX

export type CtxPayload = { channel: string; cast: Partial<Record<LiveName, { agentId: string; uid: number }>>; exp: number };

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest();

/** CTX = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, base64url(JSON payload))). The runner verifies exactly this. */
export function signCtx(secret: string, { channel, cast }: { channel: string; cast: LiveCast[] }, nowMs = Date.now()) {
  const payload: CtxPayload = {
    channel,
    cast: Object.fromEntries(cast.map((c) => [c.name, { agentId: c.agentId, uid: c.uid }])),
    exp: Math.floor(nowMs / 1000) + CTX_TTL_S,
  };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(mac(secret, body))}`;
}

/** The runner's side of signCtx (kept here for tests and as the reference): the payload, or null if forged, malformed or expired. */
export function verifyCtx(secret: string, ctx: unknown, nowMs = Date.now()): CtxPayload | null {
  if (typeof ctx !== 'string' || ctx.length > 4000) return null;
  const [body, sig, extra] = ctx.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(secret, body);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CtxPayload;
    if (typeof p?.channel !== 'string' || typeof p.exp !== 'number' || !p.cast || typeof p.cast !== 'object') return null;
    if (p.exp <= Math.floor(nowMs / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the host's tool

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Agora custom tool (llm.tools): the host calls the runner's /ask synchronously. Body leaves are
 * constants or one whole placeholder each, so the sealed CTX rides as a constant string.
 */
export function askAgentTool(live: LiveConfig, ctx: string, names: LiveName[]) {
  return {
    type: 'function',
    function: {
      name: 'ask_agent',
      description: `Ask one of the user's live agents (${names.join(', ')}) a question; they hear the meeting so far and answer aloud in their own voice in this call. Call it right away when the user addresses one of them by name or asks for their opinion; for "everyone" or "the team", ask the most relevant one (the others may jump in on their own). Say 'Asking <name>' first; when the result has spoken=true, stay quiet: don't repeat or sum up their answer.`,
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: [...names] },
          question: { type: 'string', description: "The user's question, self-contained" },
        },
        required: ['agent', 'question'],
      },
    },
    execution: { mode: 'sync' },
    server: {
      method: 'POST',
      url: `${live.runnerUrl}/ask`,
      headers: { Authorization: `Bearer ${live.secret}` },
      body: { agent: '{{args.agent}}', question: '{{args.question}}', ctx, tool_call_id: '{{tool_call_id}}' },
      timeout_ms: ASK_TIMEOUT_MS,
    },
  };
}

/** The host's instructions about who is live and how to route to everyone else. */
export function liveSystem(live: LiveName[], others: string[]) {
  const lines: string[] = [];
  if (live.length) {
    lines.push(
      `Live on this call: ${list(live)}. They are the user's real agents running on the user's laptop. They hear the meeting through its transcript and answer aloud when you call ask_agent.`,
      'You are the host and moderator of this meeting, not the main speaker: keep your own turns very short and let the agents talk.',
      `When the user addresses ${live.length > 1 ? 'one of them' : live[0]} by name or wants ${live.length > 1 ? 'their' : 'its'} opinion, call ask_agent immediately. Say only "Asking <name>" first, then stay quiet while they answer.`,
      ...(live.length > 1 ? ['When the user addresses everyone or the team, ask the single most relevant live agent first; the others jump in by themselves when they have something to add, so do not ask each of them in turn.'] : []),
      'If the result has spoken true, the agent already said its answer aloud: do not repeat or sum it up; say nothing, or at most a few words. If spoken is false, relay the answer briefly in your own words, like "Codex says ...". If ok is false, say they could not answer right now.',
      'For long jobs that should happen later, use hand_off, even for a live agent.',
    );
  } else {
    lines.push('None of their agents is live on this call.');
  }
  const off = others.filter((o) => !live.some((l) => sameAgent(o, l)));
  lines.push(
    `${off.length ? `${list(off)} ${off.length > 1 ? 'are' : 'is'} not on this call and only work` : 'Any other agent is not on this call and only works'} through Slates: never pretend they speak or answer. For anything they should do, call hand_off with "to" set to the agent's name, then say honestly that you left it for them, like "I've left that for Instinct; it'll pick it up next time it runs."`,
    'Keep every turn short.',
  );
  return lines.join(' ');
}

/** The runner's CTX for a call, rebuilt from the call reference (names come from the live uids). */
export function ctxForCall(secret: string, channel: string, cast: { agentId: string; uid: number }[], nowMs = Date.now()) {
  const named = cast
    .map((c) => ({ ...c, name: LIVE_AGENTS[c.uid - LIVE_UID0]?.name }))
    .filter((c): c is LiveCast => !!c.name);
  return signCtx(secret, { channel, cast: named }, nowMs);
}

// ------------------------------------------------------------------ the meeting room on the runner

export type AgentStatus = 'idle' | 'thinking' | 'speaking';
export type RoomLine = { kind: 'human' | 'host' | 'agent' | 'note'; who: string; text: string; at: number };
/** GET/POST RUNNER_URL/room/*: the shared transcript (you, Slates, the live agents), who has the floor, each agent's status. */
export type RoomState = { transcript: RoomLine[]; floor: { who: string; since: number } | null; status: Partial<Record<LiveName, AgentStatus>> };

/** One call to the runner's meeting room. Never throws: null when the runner is away or says no. */
export async function runnerRoom(
  live: LiveConfig,
  route: 'event' | 'hush' | 'state',
  ctx: string,
  body: Record<string, unknown> = {},
  { fetch: f = fetch, timeoutMs = 4000 }: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ state: RoomState; interrupted?: string[] } | null> {
  try {
    const get = route === 'state';
    const r = await f(`${live.runnerUrl}/room/${route}${get ? `?ctx=${encodeURIComponent(ctx)}` : ''}`, {
      method: get ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${live.secret}`, ...(get ? {} : { 'content-type': 'application/json' }) },
      body: get ? undefined : JSON.stringify({ ...body, ctx }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { ok?: boolean; state?: RoomState; interrupted?: string[] } | null;
    if (!j?.ok || !j.state || !Array.isArray(j.state.transcript)) return null;
    return { state: j.state, ...(j.interrupted ? { interrupted: j.interrupted } : {}) };
  } catch {
    return null;
  }
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "Claude Code" counts as the live Claude. */
export const sameAgent = (name: string, live: string) => flat(name).startsWith(flat(live));
