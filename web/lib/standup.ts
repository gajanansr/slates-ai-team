import 'server-only';
import type { Activity } from '@/lib/slates';
import { DESK_SLUG, type DeskItem } from '@/lib/desk';
import { AGENT_UID, CALL_SYSTEM, type CallConfig } from '@/lib/call';
import { liveSystem, sameAgent, type LiveName } from '@/lib/live-agents';

/**
 * Standup with your AI team: Slates (the host, its own voice) narrates what each agent did lately,
 * from the activity log and desk. Agents that are not live on the call never get a voice: orders
 * for them become hand_offs. The user's live agents (Claude, Codex, Antigravity) are on the call
 * and answer through the host's ask_agent tool.
 *
 * Pure parts only: what each agent did, the narration, the speak-only cast body, and the script.
 * The request flow (joins, /next, /end) lives in lib/call-server.ts.
 */

export const MAX_REPORTERS = 4;
export const REPORT_WORDS = 45;
/** Cast agents "listen" to this uid. Nobody ever joins with it, so they never answer anyone. */
export const NOBODY_UID = '9999';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const CLOSING_QUESTION = 'What should the team do next?';
export const CAST_SYSTEM = 'You only read out messages you are given.';

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Our own voice tokens and the built-in assistant speak as the host, never as a reporter. */
const isHost = (name: string) => flat(name).startsWith('slates');
const NO_NAME = new Set(['you', 'anagent', '']);

export type AgentBrief = {
  name: string;
  /** What it changed in the window, newest first, deduped ("Updated Groceries"). */
  changes: string[];
  /** Board titles it touched, newest first. */
  boards: string[];
  /** Its latest closing note in the window. */
  session?: { did: string; open?: string };
  /** Open handoffs it left for others / others left for it. */
  handedOff: { to: string; task: string }[];
  handedTo: { from: string; task: string }[];
  /** Its questions and approvals still waiting on the user. */
  asks: string[];
  lastAt: number;
};

export type StandupData = {
  agents: AgentBrief[];
  /** Everything waiting on the user, any agent. */
  waiting: { from: string; text: string }[];
  /** Open handoffs, any agent. */
  handoffs: { from: string; to: string; task: string }[];
  since: number;
};

const time = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Group the user's recent activity and desk by agent. Agents with nothing in the window are
 * skipped; the busiest, most recent MAX_REPORTERS report.
 */
export function gatherStandup(
  { activity, desk, titles = {}, since, now = Date.now() }: { activity: Activity[]; desk: DeskItem[]; titles?: Record<string, string>; since: number; now?: number },
): StandupData {
  const by = new Map<string, AgentBrief>();
  const brief = (raw: string | null | undefined) => {
    const name = clean(raw).slice(0, 40);
    const key = flat(name);
    if (NO_NAME.has(key) || isHost(name)) return null;
    let b = by.get(key);
    if (!b) by.set(key, (b = { name, changes: [], boards: [], handedOff: [], handedTo: [], asks: [], lastAt: 0 }));
    return b;
  };
  const inWindow = (t: number) => t >= since && t <= now + 60_000;

  for (const a of activity) {
    const at = time(a.created_at);
    if (!a.agent_name || !inWindow(at) || a.slate_slug === DESK_SLUG) continue;
    const b = brief(a.agent_name);
    if (!b) continue;
    const title = a.slate_slug ? titles[a.slate_slug] ?? a.slate_slug.replace(/-/g, ' ') : '';
    const what = cut(clean(a.summary) || `${a.action}${title ? ` ${title}` : ''}`, 140);
    if (what && !b.changes.includes(what) && b.changes.length < 8) b.changes.push(what);
    if (title && !b.boards.includes(title) && b.boards.length < 4) b.boards.push(title);
    b.lastAt = Math.max(b.lastAt, at);
  }

  const waiting: StandupData['waiting'] = [];
  const handoffs: StandupData['handoffs'] = [];
  for (const d of desk) {
    const at = time(d.at);
    if (d.type === 'session' && inWindow(at)) {
      const b = brief(d.from);
      if (b && !b.session) {
        b.session = { did: cut(clean(d.text), 300), open: d.context ? cut(clean(d.context), 200) : undefined };
        b.lastAt = Math.max(b.lastAt, at);
      }
    } else if (d.type === 'handoff' && d.open) {
      const to = clean(d.to) || 'any agent';
      handoffs.push({ from: clean(d.from), to, task: cut(clean(d.text), 160) });
      by.get(flat(d.from))?.handedOff.push({ to, task: cut(clean(d.text), 160) });
      for (const t of to.split(',')) by.get(flat(t))?.handedTo.push({ from: clean(d.from), task: cut(clean(d.text), 160) });
    } else if ((d.type === 'question' || d.type === 'approval') && d.open) {
      waiting.push({ from: clean(d.from), text: cut(clean(d.text), 160) });
      by.get(flat(d.from))?.asks.push(cut(clean(d.text), 160));
    }
  }

  // Only agents that did something in the window report; handoffs and asks alone ride with them or the closing.
  const agents = [...by.values()]
    .filter((b) => b.changes.length > 0 || b.session)
    .sort((x, y) => Number(!!y.session) - Number(!!x.session) || y.lastAt - x.lastAt || y.changes.length - x.changes.length)
    .slice(0, MAX_REPORTERS);
  return { agents, waiting, handoffs, since };
}

// ------------------------------------------------------------------ spoken text

/** At most `max` words; cut at a sentence end when one is close, and always end like a sentence. */
export function clampWords(text: string, max = REPORT_WORDS) {
  const words = clean(text).split(' ').filter(Boolean);
  if (words.length <= max) return words.join(' ');
  const t = words.slice(0, max).join(' ');
  const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('? '), t.lastIndexOf('! '));
  if (end > t.length * 0.5) return t.slice(0, end + 1);
  return `${t.replace(/[,;:\-–—\s]+$/, '')}.`;
}

/** Agora's speak API takes at most 512 bytes. Cut at a sentence end when we can. */
export function fitSpeech(text: string, maxBytes = 500) {
  let t = clean(text);
  if (Buffer.byteLength(t) <= maxBytes) return t;
  while (Buffer.byteLength(t) > maxBytes) t = t.slice(0, -1);
  const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('? '), t.lastIndexOf('! '));
  return end > 80 ? t.slice(0, end + 1) : t;
}

const sentence = (s: string) => {
  const t = clean(s).replace(/[.!?…]+$/, '');
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : '';
};
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The deterministic narration (Slates speaking about the agent): used without an LLM key, or when the LLM skips an agent. */
export function templateReport(b: AgentBrief) {
  const parts: string[] = [];
  if (b.session) parts.push(sentence(`${b.name} wrapped up: ${lower(b.session.did)}`));
  else {
    const n = b.changes.length;
    parts.push(n === 1 ? sentence(`${b.name} ${lower(b.changes[0])}`) : sentence(`${b.name} made ${n} changes, latest: ${lower(b.changes[0])}`));
  }
  if (b.boards.length) parts.push(`It's on your ${list(b.boards.slice(0, 2))} board${b.boards.length > 1 ? 's' : ''}.`);
  if (b.session?.open) parts.push(sentence(`Still open: ${lower(b.session.open)}`));
  if (b.asks.length) parts.push(sentence(`It needs your answer on ${lower(b.asks[0])}`));
  else if (b.handedOff.length) parts.push(sentence(`It handed ${lower(b.handedOff[0].task)} to ${b.handedOff[0].to}`));
  return clampWords(parts.filter(Boolean).join(' '));
}

/** The one line in the narrated list: what the agent did. */
export function tileLine(b: AgentBrief) {
  return cut(b.session?.did || b.changes[0] || 'Checked in', 80);
}

export const REPORT_SYSTEM = [
  "You write what Slates, the host of a user's standup, says about each of the user's AI agents.",
  `For each agent, write a spoken update about it in the third person, starting with its name (like "Gemini finished the market research"), at most ${REPORT_WORDS} words, natural and warm.`,
  'Say what it did and where it is (name the board), then anything still open or stuck, then anything it needs from the user.',
  'Use only the facts given. No lists, markdown, emoji, ids or URLs.',
  'Answer with only a JSON object mapping each agent name to its report.',
].join(' ');

export function reportPrompt(data: StandupData) {
  return JSON.stringify(
    data.agents.map((b) => ({
      agent: b.name,
      changed: b.changes,
      boards: b.boards,
      closing_note: b.session,
      handed_off: b.handedOff,
      handed_to_it: b.handedTo,
      waiting_on_user: b.asks,
    })),
  );
}

/** The LLM's JSON -> report per agent; any agent it missed (or a bad answer) falls back to the template. */
export function parseReports(raw: string | null | undefined, agents: AgentBrief[]): Record<string, string> {
  let parsed: Record<string, unknown> = {};
  const json = raw?.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const v = JSON.parse(json);
      if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const byKey = new Map(Object.entries(parsed).map(([k, v]) => [flat(k), v]));
  const out: Record<string, string> = {};
  for (const b of agents) {
    const v = byKey.get(flat(b.name));
    const text = typeof v === 'string' ? clampWords(v.replace(/[*_#`>\[\]{}]/g, '').replace(/\p{Extended_Pictographic}/gu, '')) : '';
    out[b.name] = text.split(' ').length >= 4 ? text : templateReport(b);
  }
  return out;
}

/** Reports for every reporting agent: the LLM when one answers, else the template. Never throws. */
export async function buildReports(data: StandupData, llm?: (system: string, prompt: string) => Promise<string | null>) {
  if (!data.agents.length) return {};
  let raw: string | null = null;
  if (llm) {
    try {
      raw = await llm(REPORT_SYSTEM, reportPrompt(data));
    } catch (e) {
      console.warn('[standup] report llm failed', (e as Error)?.message);
    }
  }
  return parseReports(raw, data.agents);
}

// ------------------------------------------------------------------ speak-only cast agents

export const localeOf = (voice: string) => voice.match(/^([a-z]{2}-[A-Z]{2})-/)?.[1] ?? 'en-US';

/** A speak-only agent (a live agent's voice): never listens, says only what /speak gives it. */
export function castBody(cfg: CallConfig, { channel, token, uid, voice }: { channel: string; token: string; uid: number; voice: string }) {
  return {
    name: `${channel}-${uid}`,
    properties: {
      channel,
      token,
      agent_rtc_uid: String(uid),
      remote_rtc_uids: [NOBODY_UID],
      idle_timeout: 600,
      asr: {
        credential_mode: 'managed',
        vendor: 'deepgram',
        params: { url: 'wss://api.deepgram.com/v1/listen', model: 'nova-3', language: 'en-US' },
      },
      llm: {
        credential_mode: 'managed',
        vendor: 'openai',
        style: 'openai',
        url: 'https://api.openai.com/v1/chat/completions',
        params: { model: 'gpt-4.1-mini' },
        system_messages: [{ role: 'system', content: CAST_SYSTEM }],
        max_history: 2,
      },
      tts: {
        vendor: 'murf',
        params: { api_key: cfg.murfKey, voiceId: voice, locale: localeOf(voice), model: 'FALCON', sample_rate: 24000 },
      },
    },
  };
}

// ------------------------------------------------------------------ the script

export type ScriptLine = { uid: number; who: string; text: string };
/** One narrated agent: who, and what Slates says about it. */
export type Narrated = { name: string; report: string };

const sinceLabel = (since: number, now: number) => (Math.abs(now - since - DAY_MS) < 60 * 60 * 1000 ? 'since yesterday' : 'since your last standup');
const are = (xs: string[]) => (xs.length > 1 ? 'are' : 'is');

/**
 * The host's greeting (Agora's greeting_message) and the lines /next has the host speak in order:
 * one narrated update per agent, then the closing question. Every line is the host's own voice.
 */
export function standupScript({
  firstName,
  reports,
  live = [],
  waiting,
  since,
  now = Date.now(),
}: {
  firstName: string | null | undefined;
  reports: Narrated[];
  live?: LiveName[];
  waiting: StandupData['waiting'];
  since: number;
  now?: number;
}) {
  const first = firstName?.trim().split(/\s+/)[0]?.slice(0, 40);
  const hi = first ? `Hi ${first}, it's standup time.` : "Hi, it's standup time.";
  const greeting = reports.length
    ? `${hi} Here's what your team did ${sinceLabel(since, now)}.`
    : `${hi} Nothing new from your agents ${sinceLabel(since, now)}.`;
  const host = Number(AGENT_UID);
  const script: ScriptLine[] = reports.map((r) => ({ uid: host, who: 'Slates', text: fitSpeech(r.report) }));
  const wait = waiting.length
    ? `${waiting.length === 1 ? 'One thing waits' : `${waiting.length} things wait`} on you, like ${lower(clean(waiting[0].text).replace(/[.?!]+$/, ''))}. `
    : '';
  const onCall = live.length ? `${list(live)} ${are(live)} on the call if you want to ask ${live.length > 1 ? 'them' : 'it'} anything. ` : '';
  script.push({ uid: host, who: 'Slates', text: fitSpeech(`${reports.length ? "That's everyone. " : ''}${wait}${onCall}${CLOSING_QUESTION}`) });
  return { greeting: fitSpeech(greeting), script };
}

/** The host's instructions for a standup: what it narrated, who is live, and how to route orders. */
export function standupSystem(data: StandupData, reports: Record<string, string>, live: LiveName[] = []) {
  const said = data.agents.map((b) => `- ${b.name}: ${reports[b.name] ?? templateReport(b)}`).join('\n');
  const others = data.agents.map((b) => b.name).filter((n) => !live.some((l) => sameAgent(n, l)));
  return [
    CALL_SYSTEM,
    'This call is a standup with their AI team. You host it, and you are the only one who narrates: the agents below did not speak, you read their updates from the activity log.',
    said ? `You just narrated these updates:\n${said}` : 'No agent had anything new to report.',
    data.waiting.length ? `Waiting on the user:\n${data.waiting.slice(0, 6).map((w) => `- ${w.from}: ${w.text}`).join('\n')}` : '',
    data.handoffs.length ? `Open handoffs:\n${data.handoffs.slice(0, 6).map((h) => `- ${h.from} to ${h.to}: ${h.task}`).join('\n')}` : '',
    liveSystem(live, others),
    `After the updates you ask "${CLOSING_QUESTION}". For each order: ${live.length ? 'if it is a quick question for a live agent, ask it with ask_agent; otherwise ' : ''}call hand_off with "to" set to the agent's name and the task in the user's words, then confirm in one short sentence.`,
  ]
    .filter(Boolean)
    .join('\n');
}
