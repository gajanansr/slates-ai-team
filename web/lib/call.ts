import 'server-only';
import { decrypt, encrypt, encryptionReady } from '@/lib/crypto';
import { SITE_URL } from '@/lib/env';
import type { ScriptLine } from '@/lib/standup';

/**
 * Call Slates: a voice call with the user's own assistant, through Agora Conversational AI
 * (Deepgram ASR, managed gpt-4.1-mini, Murf voice). The agent acts on the user's boards
 * through the Slates MCP server with a per-call agent token that only Agora ever sees, and asks
 * the user's live agents (lib/live-agents.ts) with its ask_agent tool.
 *
 * This file holds the pure parts (config, join body, call reference); the request flow is in
 * lib/call-server.ts.
 */

export const AGORA_API = 'https://api.agora.io/api/conversational-ai-agent/v2/projects';
export const AGENT_UID = '1000';
export const USER_UID = 1001;
/** Agora token lifetime (seconds). A call never needs longer; idle_timeout ends abandoned ones. */
export const TOKEN_TTL = 3600;
/** The per-call Slates token lives a day (create_agent's minimum); the call reference matches it. */
export const CALL_TOKEN_DAYS = 1;
export const CALL_REF_TTL_MS = CALL_TOKEN_DAYS * 24 * 60 * 60 * 1000;
export const VOICE_AGENT_NAME = 'Slates Voice';

/** Tools the voice agent may use. No archive, delete, restore or automation tools. */
export const CALL_TOOLS = [
  'get_about_me',
  'check_desk',
  'list_slates',
  'get_slate',
  'search',
  'find_notes',
  'get_note',
  'add_note',
  'update_note',
  'patch_items',
  'create_slate',
  'remind',
  'list_reminders',
  'complete_reminder',
  'hand_off',
  'set_today_brief',
  'capture',
  'list_inbox',
  'recent_activity',
  'what_changed',
  'build_agent', // "Manage my dairy business" builds a custom agent while you talk
] as const;

export const CALL_SYSTEM = [
  "You are Slates, the user's own assistant, on a voice call with them.",
  'You can read and change their Slates boards, notes and reminders with your tools.',
  'Hand bigger jobs to their AI agents with hand_off: send code, websites, research or anything multi-step to "Claude". It reports back on their desk, and Slates will call them if it needs a decision.',
  'When they ask you to manage, run or look after something ongoing (a business, a goal, a project, deal hunting), call build_agent with their goal: it builds them a custom agent with its own boards and routines in seconds. Then tell them its name and one line on what it will do, and ask the personalisation questions it returns, one at a time.',
  'Do what they ask, then say in one short sentence what you did.',
  'Confirm before anything destructive, like removing items or overwriting a note.',
  'Reply in one or two short spoken sentences. No lists, markdown, symbols or emoji.',
  'Never invent board contents: read them with your tools first.',
  'When they are done, say Goodbye.',
].join(' ');

export type CallConfig = { appId: string; cert: string; murfKey: string };

/**
 * A host other than Slates: an Agent Studio agent taking the call itself (lib/agent-call.ts).
 * Its name, Murf voice, system prompt, greeting, the boards its per-call token is limited to,
 * and the MCP tools it may use.
 */
export type CallPersona = { name: string; voiceId: string; locale: string; system: string; greeting: string; boards: string[]; tools: readonly string[] };

/** Server env for calling, or null when any piece is missing (the route answers 503). */
export function callConfig(env: Record<string, string | undefined> = process.env): CallConfig | null {
  const appId = env.AGORA_APP_ID?.trim();
  const cert = env.AGORA_APP_CERTIFICATE?.trim();
  const murfKey = env.MURF_API_KEY?.trim();
  if (!appId || !cert || !murfKey || !encryptionReady()) return null;
  return { appId, cert, murfKey };
}

/** The host's first words; names the live agents that really joined, if any. */
export function greetingFor(firstName: string | null | undefined, live: string[] = []) {
  const name = firstName?.trim().split(/\s+/)[0]?.slice(0, 40);
  const hi = name ? `Hi ${name}, it's Slates.` : "Hi, it's Slates.";
  const also = live.length ? ` ${live.length === 1 ? live[0] : `${live.slice(0, -1).join(', ')} and ${live[live.length - 1]}`} ${live.length > 1 ? 'are' : 'is'} on the line too.` : '';
  return `${hi}${also} What can I do for you?`;
}

/** The body for Agora's /join: one listening agent on the channel, talking to the user's uid. */
export function joinBody(
  cfg: CallConfig,
  {
    channel,
    hostToken,
    slatesToken,
    greeting,
    system = CALL_SYSTEM,
    mcpUrl = `${SITE_URL}/mcp`,
    standup = false,
    tools,
    persona,
  }: {
    channel: string;
    hostToken: string;
    slatesToken: string;
    greeting: string;
    system?: string;
    mcpUrl?: string;
    standup?: boolean;
    /** Custom tools (the live agents' ask_agent), next to the Slates MCP tools. */
    tools?: unknown[];
    /** An agent hosts instead of Slates: its system prompt, greeting, voice and tools win. */
    persona?: CallPersona;
  },
) {
  if (persona) {
    system = persona.system;
    greeting = persona.greeting;
  }
  return {
    name: channel,
    properties: {
      channel,
      token: hostToken,
      agent_rtc_uid: AGENT_UID,
      remote_rtc_uids: [String(USER_UID)],
      idle_timeout: 30,
      advanced_features: { enable_tools: true },
      turn_detection: { config: { speech_threshold: 0.6 } },
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
        system_messages: [{ role: 'system', content: system }],
        greeting_message: greeting,
        failure_message: 'Sorry, could you say that again?',
        max_history: 20,
        mcp_servers: [
          {
            name: 'slates',
            transport: 'streamable_http',
            endpoint: mcpUrl,
            headers: { Authorization: `Bearer ${slatesToken}` },
            allowed_tools: [...(persona?.tools ?? CALL_TOOLS)],
            timeout_ms: 15000,
          },
        ],
        ...(tools?.length ? { tools } : {}),
      },
      tts: {
        vendor: 'murf',
        params: { api_key: cfg.murfKey, voiceId: persona?.voiceId ?? 'en-US-natalie', locale: persona?.locale ?? 'en-US', model: 'FALCON', sample_rate: 24000 },
      },
      parameters: {
        // In a standup the user's mic is muted while the team reports, so a silence nudge would talk over them.
        silence_config: {
          timeout_ms: standup ? 0 : 15000,
          action: 'think',
          content: "The user has been quiet. Briefly ask if there's anything else; if this is the second time, say Goodbye.",
        },
        farewell_config: { graceful_enabled: true, graceful_timeout_seconds: 5 },
      },
    },
  };
}

// ------------------------------------------------------------------ call reference

/** A speak-only voice in the channel (a live agent): its Agora agent id and uid. */
export type CastRef = { agentId: string; uid: number };
/** A standup's narration: the lines the host speaks through /next, in order. */
export type StandupRef = { script: ScriptLine[] };
/** What the browser carries between start and end. Encrypted + authenticated (AES-GCM), so it is opaque and tamper-proof. */
export type CallRef = { agentId: string; slatesAgentId: string; channel: string; userId: string; exp: number; cast?: CastRef[]; standup?: StandupRef };

const MAX_REF = 8000;

export function signCallRef(ref: Omit<CallRef, 'exp'>, now = Date.now()) {
  const body: CallRef = { ...ref, exp: now + CALL_REF_TTL_MS };
  return encrypt(JSON.stringify({ v: 1, ...body }));
}

const str = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

function castOf(c: unknown): CastRef[] | null | undefined {
  if (c === undefined) return undefined;
  if (!Array.isArray(c) || c.length > 4) return null;
  const cast = c.map((x) => (str(x?.agentId) && Number.isInteger(x?.uid) && x.uid >= 2001 && x.uid <= 2004 ? { agentId: x.agentId as string, uid: x.uid as number } : null));
  return cast.some((x) => !x) ? null : (cast as CastRef[]);
}

/** The narration is the host's alone: every scripted line is spoken by Slates. */
function standupOf(s: unknown): StandupRef | null | undefined {
  if (s === undefined) return undefined;
  const r = s as Partial<StandupRef> | null;
  if (!r || !Array.isArray(r.script) || r.script.length > 12) return null;
  const script = r.script.map((l) => (l && l.uid === Number(AGENT_UID) && str(l.who, 60) && str(l.text, 600) ? { uid: l.uid, who: l.who, text: l.text } : null));
  if (script.some((l) => !l)) return null;
  return { script: script as ScriptLine[] };
}

/** The reference, or null if it was tampered with, expired, or malformed. */
export function verifyCallRef(token: unknown, now = Date.now()): CallRef | null {
  if (typeof token !== 'string' || token.length > MAX_REF) return null;
  try {
    const r = JSON.parse(decrypt(token)) as Partial<CallRef> & { v?: number };
    if (r.v !== 1) return null;
    if (!str(r.agentId) || !str(r.slatesAgentId) || !str(r.channel) || !str(r.userId)) return null;
    if (typeof r.exp !== 'number' || r.exp <= now) return null;
    const cast = castOf(r.cast);
    const standup = standupOf(r.standup);
    if (cast === null || standup === null) return null;
    return {
      agentId: r.agentId,
      slatesAgentId: r.slatesAgentId,
      channel: r.channel,
      userId: r.userId,
      exp: r.exp,
      ...(cast ? { cast } : {}),
      ...(standup ? { standup } : {}),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ captions

/** `who` is Slates or You. */
export type Caption = { who: string; text: string };

/** Agora history -> captions (last 30 lines, trimmed). */
export function toCaptions(history: unknown): Caption[] {
  const contents = (history as { contents?: unknown })?.contents;
  if (!Array.isArray(contents)) return [];
  return contents
    .filter((c): c is { role: string; content: string } => typeof c?.content === 'string' && (c.role === 'user' || c.role === 'assistant'))
    .map((c) => ({ who: c.role === 'assistant' ? 'Slates' : 'You', text: c.content.trim().slice(0, 600) }))
    .filter((c) => c.text)
    .slice(-30);
}

/**
 * Standup captions in speaking order: the host's greeting, the narration spoken so far, then
 * the rest of the conversation. Scripted host lines also show up in its history: drop those so
 * nothing shows twice.
 */
export function mergeCaptions(history: Caption[], spoken: ScriptLine[]): Caption[] {
  const said = new Set(spoken.map((s) => s.text.trim()));
  const rest = history.filter((c) => !said.has(c.text));
  const head = rest[0]?.who === 'Slates' ? [rest.shift()!] : [];
  return [...head, ...spoken.map((s) => ({ who: s.who, text: s.text })), ...rest].slice(-30);
}

/** A line of the runner's meeting transcript (see lib/live-agents.ts RoomState). */
type RoomCaptionLine = { kind: string; who: string; text: string };
const capKey = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Captions with the live agents' lines woven in. The host's captions (`base`) stay as they are; each agent line
 * from the room transcript goes right after the owner/host line it followed there. Both are in speaking order, so
 * a repeated line ("Asking Claude") is matched from the end. Agent lines whose anchor scrolled out are dropped,
 * unless they are newer than every placed line (then they go at the end). Notes like "[Claude was interrupted]" are not captions.
 */
export function mergeRoomCaptions(base: Caption[], room: RoomCaptionLine[] | null | undefined): Caption[] {
  if (!room?.length) return base;
  // One group per owner/host line: the agent lines that followed it (null: before any).
  type Group = { anchor: string | null; lines: Caption[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const l of room) {
    if (l.kind === 'human' || l.kind === 'host') groups.push((current = { anchor: capKey(l.text), lines: [] }));
    else if (l.kind === 'agent' && l.text?.trim()) {
      if (!current) groups.push((current = { anchor: null, lines: [] }));
      current.lines.push({ who: l.who, text: l.text });
    }
  }
  if (!groups.some((g) => g.lines.length)) return base;
  const after = new Map<number, Caption[]>(); // base index → agent lines after it
  const placed = new Set<Group>();
  const byKey = new Map<string, Group[]>();
  for (const g of groups) if (g.anchor !== null) byKey.set(g.anchor, [...(byKey.get(g.anchor) ?? []), g]);
  for (const [k, gs] of byKey) {
    const at = base.flatMap((c, i) => (capKey(c.text) === k ? [i] : []));
    for (let j = 1; j <= Math.min(at.length, gs.length); j++) {
      const g = gs[gs.length - j];
      const i = at[at.length - j];
      after.set(i, [...(after.get(i) ?? []), ...g.lines]);
      placed.add(g);
    }
  }
  const firstPlaced = groups.findIndex((g) => placed.has(g));
  const lastPlaced = groups.reduce((m, g, i) => (placed.has(g) ? i : m), -1);
  const head = groups.filter((g, i) => g.anchor === null && !placed.has(g) && (firstPlaced < 0 || i < firstPlaced)).flatMap((g) => g.lines);
  const tail = groups.filter((g, i) => g.anchor !== null && !placed.has(g) && i > lastPlaced).flatMap((g) => g.lines);
  const out: Caption[] = [...head];
  base.forEach((c, i) => out.push(c, ...(after.get(i) ?? [])));
  return [...out, ...tail].slice(-30);
}
