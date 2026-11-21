import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConvoAITokenBuilder, RtcRole, RtcTokenBuilder } from 'agora-token';
import { slates, SlatesError } from '@/lib/slates';
import { desk } from '@/lib/desk';
import { completeText } from '@/lib/assistant';
import {
  DAY_MS,
  buildReports,
  castBody,
  gatherStandup,
  standupScript,
  standupSystem,
  tileLine,
  type ScriptLine,
} from '@/lib/standup';
import { loadPersona, type AgentPersona, type CallAgent } from '@/lib/agent-call';
import {
  LIVE_AGENTS,
  LIVE_UID0,
  askAgentTool,
  ctxForCall,
  liveConfig,
  liveSystem,
  runnerRoom,
  signCtx,
  type LiveCast,
  type LiveConfig,
  type RoomState,
} from '@/lib/live-agents';
import {
  AGENT_UID,
  AGORA_API,
  CALL_SYSTEM,
  CALL_TOKEN_DAYS,
  TOKEN_TTL,
  USER_UID,
  VOICE_AGENT_NAME,
  callConfig,
  greetingFor,
  joinBody,
  mergeCaptions,
  mergeRoomCaptions,
  signCallRef,
  toCaptions,
  verifyCallRef,
  type Caption,
  type CallConfig,
  type CallRef,
} from '@/lib/call';

/** Everything the call flow touches, injectable for tests. `sb` is the user's session client. */
export type CallDeps = {
  sb: SupabaseClient;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** One-shot text model for standup reports (default: the providers Ask uses). */
  llm?: (system: string, prompt: string) => Promise<string | null>;
};

/** A tile: who is on the call (Slates, and each live agent) and the one line under their name. */
export type Participant = { uid: number; name: string; line: string; live?: boolean };
export type StartedCall = {
  appId: string;
  channel: string;
  rtcToken: string;
  uid: number;
  callRef: string;
  /** Everyone with a voice on the call: Slates first, then the live agents that joined. */
  participants: Participant[];
  /** Standups only: whose uid speaks at each /next step (always the host), and the narrated updates (shown under Slates). */
  standup?: { order: number[]; reports: { name: string; line: string }[] };
  /** Agent calls only: the Agent Studio agent hosting instead of Slates. */
  agent?: CallAgent;
};
export type CallMode = 'call' | 'standup';

const NOT_SET_UP = () => new SlatesError("Calling isn't set up yet.", 503, 'unavailable');
/** Leftover per-call tokens older than this are revoked when a new call starts (in case end never fired). */
const STALE_MS = 3 * 60 * 60 * 1000;

/** A ConvoAI token for the agent at `uid` (the host, or a standup cast member). Rebuilt from the cert, so the ref never carries one. */
const agentToken = (cfg: CallConfig, channel: string, uid: string | number) => ConvoAITokenBuilder.buildToken(cfg.appId, cfg.cert, channel, String(uid), TOKEN_TTL, TOKEN_TTL);
const hostToken = (cfg: CallConfig, channel: string) => agentToken(cfg, channel, AGENT_UID);

async function agora(
  deps: CallDeps,
  cfg: CallConfig,
  path: string,
  { method = 'POST', body, token, timeoutMs = 10000 }: { method?: 'GET' | 'POST'; body?: unknown; token: string; timeoutMs?: number },
) {
  const res = await (deps.fetch ?? fetch)(`${AGORA_API}/${encodeURIComponent(cfg.appId)}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `agora token="${token}"` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Revoke one per-call token. Already revoked counts as done (idempotent). */
async function revoke(sb: SupabaseClient, id: string) {
  const { error } = await sb.rpc('revoke_agent', { p_id: id });
  if (error && error.code !== 'P0404') throw new SlatesError('Could not end the call token.', 500, 'internal');
}

/** Best effort: revoke voice tokens from calls whose end never arrived (closed tab, lost signal). */
async function revokeStale(deps: CallDeps) {
  const cutoff = new Date((deps.now?.() ?? Date.now()) - STALE_MS).toISOString();
  const { data } = await deps.sb
    .from('agents')
    .select('id')
    .eq('name', VOICE_AGENT_NAME)
    .eq('kind', 'slates')
    .is('revoked_at', null)
    .lt('created_at', cutoff)
    .limit(10);
  await Promise.all(((data ?? []) as { id: string }[]).map((a) => revoke(deps.sb, a.id).catch(() => {})));
}

/** Standup window: since the last standup the browser remembers, else the last 24 h; never more than a week. */
export function standupSince(raw: unknown, now: number) {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t) || t >= now) return now - DAY_MS;
  return Math.max(t, now - 7 * DAY_MS);
}

/** What the team did, as reports: read with the user's own session (RLS), so only their data. */
async function prepareStandup(deps: CallDeps, since: number, now: number) {
  const caller = { client: deps.sb, token: null };
  const [activity, onDesk, all] = await Promise.all([
    slates.activity(caller, 200).catch(() => []),
    desk.list(caller).catch(() => []),
    slates.list(caller).catch(() => []),
  ]);
  const titles = Object.fromEntries(all.map((x) => [x.slug, x.title]));
  const data = gatherStandup({ activity, desk: onDesk, titles, since, now });
  const reports = await buildReports(data, deps.llm ?? ((sys, prompt) => completeText(sys, prompt)));
  return { data, reports };
}

/** Agent names seen in the last week (not the host, not the user): who works only through Slates. */
async function recentAgents(deps: CallDeps, now: number) {
  try {
    const activity = await slates.activity({ client: deps.sb, token: null }, 100);
    return gatherStandup({ activity: Array.isArray(activity) ? activity : [], desk: [], since: now - 7 * DAY_MS, now }).agents.map((a) => a.name);
  } catch {
    return [];
  }
}

/**
 * The live agents' voices join first, so their agent ids can be sealed into the host's ask_agent
 * tool. Each is speak-only (never listens); a voice that fails to join is simply not live.
 */
async function joinLiveCast(deps: CallDeps, cfg: CallConfig, channel: string): Promise<LiveCast[]> {
  const joined = await Promise.all(
    LIVE_AGENTS.map(async (a, i) => {
      const uid = LIVE_UID0 + i;
      const token = agentToken(cfg, channel, uid);
      try {
        const r = await agora(deps, cfg, '/join', { body: castBody(cfg, { channel, token, uid, voice: a.voice }), token, timeoutMs: 12000 });
        if (r.ok && typeof r.json?.agent_id === 'string') return { name: a.name, uid, agentId: r.json.agent_id as string };
        console.warn('[call] live voice join failed', a.name, r.status, r.text.slice(0, 200));
      } catch (e: any) {
        console.warn('[call] live voice join error', a.name, e?.message);
      }
      return null;
    }),
  );
  return joined.filter((c): c is LiveCast => !!c);
}

/** The host's custom tools: ask_agent for the live agents that joined (none without a runner). */
function hostTools(live: LiveConfig | null, channel: string, cast: LiveCast[], now: number) {
  if (!live || !cast.length) return undefined;
  return [askAgentTool(live, signCtx(live.secret, { channel, cast }, now), cast.map((c) => c.name))];
}

async function leave(deps: CallDeps, cfg: CallConfig, agentId: string, token: string) {
  try {
    const r = await agora(deps, cfg, `/agents/${encodeURIComponent(agentId)}/leave`, { token, timeoutMs: 8000 });
    // 404: the agent already left (said Goodbye or timed out). Anything else is logged.
    if (!r.ok && r.status !== 404) console.warn('[call] leave failed', r.status, r.text.slice(0, 200));
  } catch (e: any) {
    console.warn('[call] leave error', e?.message);
  }
}

export async function startCall(
  deps: CallDeps,
  user: { id: string; firstName: string | null },
  opts: { mode?: CallMode; since?: unknown; /** An Agent Studio agent's slug: it hosts the call (lib/agent-call.ts). */ agent?: unknown } = {},
): Promise<StartedCall> {
  const cfg = callConfig(deps.env);
  if (!cfg) throw NOT_SET_UP();
  const now = deps.now?.() ?? Date.now();
  // An agent call is a plain call with that agent as the host: no standup, no live voices.
  const persona: AgentPersona | null = opts.agent === undefined ? null : await loadPersona(deps.sb, opts.agent, user.firstName);
  const isStandup = !persona && opts.mode === 'standup';
  const since = standupSince(opts.since, now);

  await revokeStale(deps).catch((e) => console.warn('[call] stale cleanup', e?.message));

  const live = persona ? null : liveConfig(deps.env);
  const channel = `slates-${randomBytes(10).toString('hex')}`;
  const host = hostToken(cfg, channel);
  const rtcToken = RtcTokenBuilder.buildTokenWithUid(cfg.appId, cfg.cert, channel, USER_UID, RtcRole.PUBLISHER, TOKEN_TTL, TOKEN_TTL);

  // The reports (an LLM call) and the live voices' joins run while the per-call token is made.
  const [prepared, others, created, cast] = await Promise.all([
    isStandup ? prepareStandup(deps, since, now) : Promise.resolve(null),
    isStandup || persona ? Promise.resolve([] as string[]) : recentAgents(deps, now),
    deps.sb.rpc('create_agent', {
      p_name: VOICE_AGENT_NAME,
      p_kind: 'slates',
      p_scopes: ['read', 'write'],
      p_days: CALL_TOKEN_DAYS,
      // An agent's token reaches only its own boards (+ notes and desk).
      ...(persona ? { p_boards: persona.boards } : {}),
    }),
    live ? joinLiveCast(deps, cfg, channel) : Promise.resolve([] as LiveCast[]),
  ]);
  // Nothing may outlive a failed start: the live voices leave.
  const castLeaves = () => Promise.all(cast.map((c) => leave(deps, cfg, c.agentId, agentToken(cfg, channel, c.uid))));
  const { data, error } = created;
  if (error) {
    await castLeaves();
    throw new SlatesError(error.code === 'P0422' ? error.message : 'Could not start the call.', error.code === 'P0401' ? 401 : 422, 'invalid');
  }
  const { token: slatesToken, agent } = (data ?? {}) as { token?: string; agent?: { id?: string } };
  if (!slatesToken || !agent?.id) {
    await castLeaves();
    throw new SlatesError('Could not start the call.', 500, 'internal');
  }

  const liveNames = cast.map((c) => c.name);
  const narrated = prepared ? prepared.data.agents.map((b) => ({ name: b.name, report: prepared.reports[b.name], line: tileLine(b) })) : [];
  const plan = prepared ? standupScript({ firstName: user.firstName, reports: narrated, live: liveNames, waiting: prepared.data.waiting, since, now }) : null;

  let agentId: string | null = null;
  try {
    const r = await agora(deps, cfg, '/join', {
      body: joinBody(cfg, {
        channel,
        hostToken: host,
        slatesToken,
        greeting: plan?.greeting ?? greetingFor(user.firstName, liveNames),
        system: prepared ? standupSystem(prepared.data, prepared.reports, liveNames) : `${CALL_SYSTEM}\n${liveSystem(liveNames, others)}`,
        standup: !!prepared,
        tools: hostTools(live, channel, cast, now),
        ...(persona ? { persona } : {}),
      }),
      token: host,
      timeoutMs: 15000,
    });
    if (r.ok && typeof r.json?.agent_id === 'string') agentId = r.json.agent_id;
    else console.warn('[call] join failed', r.status, r.text.slice(0, 300));
  } catch (e: any) {
    console.warn('[call] join error', e?.message);
  }
  if (!agentId) {
    // Nothing may outlive a failed start: the live voices leave and the token, never used, is taken back.
    await castLeaves();
    await revoke(deps.sb, agent.id).catch(() => {});
    throw new SlatesError("Slates couldn't pick up right now. Try again in a moment.", 502, 'upstream');
  }

  const callRef = signCallRef(
    {
      agentId,
      slatesAgentId: agent.id,
      channel,
      userId: user.id,
      ...(cast.length ? { cast: cast.map((c) => ({ agentId: c.agentId, uid: c.uid })) } : {}),
      ...(plan ? { standup: { script: plan.script } } : {}),
    },
    deps.now?.(),
  );
  return {
    appId: cfg.appId,
    channel,
    rtcToken,
    uid: USER_UID,
    callRef,
    participants: [{ uid: Number(AGENT_UID), name: persona?.name ?? 'Slates', line: persona ? 'Your agent' : plan ? 'Hosting' : 'Your assistant' }, ...cast.map((c) => ({ uid: c.uid, name: c.name, line: 'On your laptop', live: true }))],
    ...(plan ? { standup: { order: plan.script.map((l) => l.uid), reports: narrated.map((n) => ({ name: n.name, line: n.line })) } } : {}),
    ...(persona ? { agent: persona.agent } : {}),
  };
}

function checkRef(deps: CallDeps, userId: string, raw: unknown) {
  const ref = verifyCallRef(raw, deps.now?.());
  if (!ref) throw new SlatesError('Unknown or expired call.', 400, 'invalid');
  if (ref.userId !== userId) throw new SlatesError('Not your call.', 403, 'forbidden');
  return ref;
}

/** Stop the voice agent (and the live voices) and revoke the per-call token. Safe to call more than once. */
export async function endCall(deps: CallDeps, userId: string, raw: unknown): Promise<{ ok: true }> {
  const ref = checkRef(deps, userId, raw);
  // RLS only shows the user's own agents: no row means the token is not theirs.
  const { data: row, error } = await deps.sb.from('agents').select('id, revoked_at').eq('id', ref.slatesAgentId).maybeSingle();
  if (error) throw new SlatesError('Could not end the call.', 500, 'internal');
  if (!row) throw new SlatesError('Not your call.', 403, 'forbidden');

  const cfg = callConfig(deps.env);
  if (cfg) {
    // The host and every live voice leave; failures are logged and the token is still revoked.
    await Promise.all([
      leave(deps, cfg, ref.agentId, hostToken(cfg, ref.channel)),
      ...(ref.cast ?? []).map((c) => leave(deps, cfg, c.agentId, agentToken(cfg, ref.channel, c.uid))),
    ]);
  }
  if (!(row as { revoked_at: string | null }).revoked_at) await revoke(deps.sb, ref.slatesAgentId);
  return { ok: true };
}

/** What the page shows per live agent: who has the floor and whether each is idle, thinking or speaking. */
export type RoomView = { floor: RoomState['floor']; status: RoomState['status'] };
const roomView = (s: RoomState): RoomView => ({ floor: s.floor ?? null, status: s.status ?? {} });

/** The runner's CTX for this call, or null when the call has no live agents (or no runner). */
function roomCtx(deps: CallDeps, ref: CallRef) {
  const live = liveConfig(deps.env);
  if (!live || !ref.cast?.length) return null;
  return { live, ctx: ctxForCall(live.secret, ref.channel, ref.cast, deps.now?.() ?? Date.now()) };
}

/**
 * Live captions from the agent's conversation history. `ended` once Agora no longer knows the agent.
 * With live agents, the host's lines (yours and Slates') are also sent to the runner's meeting room, so the agents
 * hear them, and the room's agent lines are woven into the captions; `room` carries each agent's status.
 */
export async function callCaptions(deps: CallDeps, userId: string, raw: unknown, step?: number): Promise<{ captions: Caption[]; ended: boolean; room?: RoomView }> {
  const ref = checkRef(deps, userId, raw);
  const cfg = callConfig(deps.env);
  if (!cfg) throw NOT_SET_UP();
  const r = await agora(deps, cfg, `/agents/${encodeURIComponent(ref.agentId)}/history`, {
    method: 'GET',
    token: hostToken(cfg, ref.channel),
    timeoutMs: 6000,
  }).catch(() => null);
  if (!r) return { captions: [], ended: false };
  if (r.status === 404) return { captions: [], ended: true };
  if (!r.ok) return { captions: [], ended: false };
  const history = toCaptions(r.json);
  // Standup: weave in the narration spoken so far, in order.
  const spoken = ref.standup && Number.isInteger(step) && step! >= 0 ? ref.standup.script.slice(0, step! + 1) : [];
  const base = ref.standup ? mergeCaptions(history, spoken) : history;
  const rc = roomCtx(deps, ref);
  const synced = rc ? await runnerRoom(rc.live, 'event', rc.ctx, { history, host: { agentId: ref.agentId } }, { fetch: deps.fetch }) : null;
  if (!synced) return { captions: base, ended: false };
  return { captions: mergeRoomCaptions(base, synced.state.transcript), ended: false, room: roomView(synced.state) };
}

export type HushResult = { ok: true; host: boolean; interrupted: string[]; room?: RoomView };

/**
 * You started talking over someone: Slates stops (its own interrupt) and the runner interrupts every live agent
 * that is speaking (`uids`: the voices the page hears) and gives you the floor. Best effort on both sides.
 */
export async function callHush(deps: CallDeps, userId: string, raw: unknown, uids?: unknown): Promise<HushResult> {
  const ref = checkRef(deps, userId, raw);
  const cfg = callConfig(deps.env);
  if (!cfg) throw NOT_SET_UP();
  const heard = Array.isArray(uids) ? uids.filter((u): u is number => Number.isInteger(u) && u >= LIVE_UID0 && u < LIVE_UID0 + LIVE_AGENTS.length).slice(0, 4) : [];
  const rc = roomCtx(deps, ref);
  const [host, room] = await Promise.all([
    agora(deps, cfg, `/agents/${encodeURIComponent(ref.agentId)}/interrupt`, { body: {}, token: hostToken(cfg, ref.channel), timeoutMs: 5000 })
      .then((r) => r.ok)
      .catch(() => false),
    rc ? runnerRoom(rc.live, 'hush', rc.ctx, { uids: heard }, { fetch: deps.fetch }) : Promise.resolve(null),
  ]);
  return { ok: true, host, interrupted: room?.interrupted ?? [], ...(room ? { room: roomView(room.state) } : {}) };
}

export type NextResult = { ok: boolean; step: number; uid: number | null; last: boolean; done: boolean };

/**
 * Standup turn-taking, driven by the browser: when the previous voice went quiet, it asks for
 * `step`, and the host says that line of the narration through Agora's speak API. Out of range is a no-op.
 */
export async function standupNext(deps: CallDeps, userId: string, raw: unknown, step: unknown): Promise<NextResult> {
  const ref = checkRef(deps, userId, raw);
  if (!ref.standup) throw new SlatesError('Not a standup.', 400, 'invalid');
  const { script } = ref.standup;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step >= script.length) return { ok: true, step: Number(step) || 0, uid: null, last: true, done: true };
  const cfg = callConfig(deps.env);
  if (!cfg) throw NOT_SET_UP();
  const line: ScriptLine = script[step];
  const speaker = speakerOf(ref, line.uid);
  const last = step === script.length - 1;
  if (!speaker) return { ok: false, step, uid: line.uid, last, done: last };
  let ok = false;
  try {
    const r = await agora(deps, cfg, `/agents/${encodeURIComponent(speaker)}/speak`, {
      // The closing question may be interrupted by the user's answer; reports may not.
      body: { text: line.text, priority: 'INTERRUPT', interruptable: last },
      token: agentToken(cfg, ref.channel, line.uid),
      timeoutMs: 8000,
    });
    ok = r.ok;
    if (!r.ok) console.warn('[call] speak failed', r.status, r.text.slice(0, 200));
  } catch (e: any) {
    console.warn('[call] speak error', e?.message);
  }
  return { ok, step, uid: line.uid, last, done: last };
}

function speakerOf(ref: CallRef, uid: number) {
  if (String(uid) === AGENT_UID) return ref.agentId;
  return ref.cast?.find((c) => c.uid === uid)?.agentId ?? null;
}
