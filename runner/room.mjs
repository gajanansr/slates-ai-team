// Meeting rooms for live voice calls: one per Agora channel (from the verified call ctx).
// A room keeps the shared transcript (owner, Slates host, live agents), who holds the floor, and each live agent's
// status, so agents can hear each other, jump in, yield when interrupted, and the owner always wins.
//
// HTTP (same public server as /ask, all with "Authorization: Bearer <ASK_SECRET>" and a valid ctx):
//   POST /room/event  { ctx, lines?: [{who:"You"|"Slates", text}], history?: [{who, text}], host?: {agentId} }
//                     lines are appended; history is the host's whole caption window, only new lines are appended.
//   POST /room/hush   { ctx, uids?: number[] }  the owner started talking: every speaking agent is interrupted.
//   GET  /room/state?ctx=…                        transcript tail, floor and statuses (for the UI).
// Every reply: { ok: true, state } or { ok: false, error } (401 without the bearer or a valid ctx).

import crypto from "node:crypto";
import { speechMs } from "./agora.mjs";

export const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
/** Agent turns in a row (no owner in between) before the room yields back to the owner. */
export const MAX_AGENT_RUN = 2;
/** How long a barge-in keeps the floor for the owner if their words never arrive (ASR dropped them). */
export const HUMAN_FLOOR_MS = 10_000;
/** TTS warm-up before a voice is heard (Murf streams after a short delay). */
const WARMUP_MS = 1500;
const MAX_LINES = 200;
const MAX_TEXT = 1200;
const MAX_BODY = 64 * 1024;

/** One line on each live agent, for the jump-in moderator. */
export const AGENT_ROLES = {
  Claude: "Anthropic's Claude Code: careful reasoning, writing, code review and planning.",
  Codex: "OpenAI's Codex CLI: pragmatic engineer, fast at code, fixes and concrete next steps.",
  Antigravity: "Google's Antigravity (Gemini): broad knowledge, research, facts and Google products.",
};

const HUMAN_WHO = new Set(["you", "human", "user", "owner"]);
const HOST_WHO = new Set(["slates", "host", "assistant"]);

// ---------- rooms ----------

export function createRooms({ now = () => Date.now(), idleMs = ROOM_IDLE_MS } = {}) {
  const map = new Map();
  function sweep() {
    const cutoff = now() - idleMs;
    for (const [k, r] of map) if (r.touched < cutoff) map.delete(k);
  }
  function get(channel, cast) {
    sweep();
    let r = map.get(channel);
    if (!r) {
      r = newRoom(channel);
      map.set(channel, r);
    }
    r.touched = now();
    if (cast && typeof cast === "object") r.cast = cast;
    return r;
  }
  return { get, peek: (channel) => map.get(channel) || null, sweep, get size() { return map.size; } };
}

export function newRoom(channel) {
  return {
    channel,
    cast: {},
    host: null, // { agentId } once the web app reports it
    transcript: [], // { kind: "human"|"host"|"agent"|"note", who, text, at }
    floor: null, // { who, since }
    speakingUntil: {}, // agent → ms
    thinking: {}, // agent → count of CLI runs in flight
    lastAgent: null,
    agentRun: 0,
    humanAt: 0,
    hushedAt: 0,
    seq: 0, // bumps on every line and barge-in: "did the owner act since X started?"
    humanSeq: 0,
    hushSeq: 0,
    hostAt: 0,
    historySeen: [], // the last host-history window, to find new lines
    jumping: false,
    touched: 0,
  };
}

export function addLine(room, { kind, who, text }, now = Date.now()) {
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!t) return null;
  room.seq++;
  const line = { kind, who, text: t, at: now };
  room.transcript.push(line);
  if (room.transcript.length > MAX_LINES) room.transcript.splice(0, room.transcript.length - MAX_LINES);
  if (kind === "human") {
    room.agentRun = 0;
    room.humanAt = now;
    room.humanSeq = room.seq;
    if (room.floor?.who === "human") room.floor = null; // they finished: the floor is open again
  } else if (kind === "agent") {
    room.agentRun++;
    room.lastAgent = who;
  } else if (kind === "host") {
    room.hostAt = now;
  }
  return line;
}

/** The owner spoke or barged in after sequence point `seq`. */
export const ownerActedSince = (room, seq) => room.humanSeq > seq || room.hushSeq > seq;

export const castNames = (room) => Object.keys(room.cast || {});

export function statusOf(room, name, now = Date.now()) {
  if ((room.speakingUntil[name] || 0) > now) return "speaking";
  if ((room.thinking[name] || 0) > 0) return "thinking";
  return "idle";
}

export function setThinking(room, name, on) {
  room.thinking[name] = Math.max(0, (room.thinking[name] || 0) + (on ? 1 : -1));
}

/** Who holds the floor now: an agent while its speech lasts, the owner after a barge-in until their words arrive. */
export function floorOf(room, now = Date.now()) {
  const f = room.floor;
  if (!f) return null;
  if (f.who === "human") return now - f.since < HUMAN_FLOOR_MS ? f : null;
  return (room.speakingUntil[f.who] || 0) > now ? f : null;
}

/** Agents that must stop before `name` speaks: every other cast agent whose speech is still playing. */
export function speakersToInterrupt(room, name, now = Date.now()) {
  return castNames(room).filter((n) => n !== name && (room.speakingUntil[n] || 0) > now);
}

/**
 * `name` takes the floor with `text` (after its interruptions were sent): the interrupted agents stop, a note goes
 * in the transcript for their next prompt, then its own line.
 */
export function takeFloor(room, name, text, { interrupted = [], now = Date.now() } = {}) {
  for (const n of interrupted) {
    room.speakingUntil[n] = 0;
    addLine(room, { kind: "note", who: n, text: `[${n} was interrupted by ${name}]` }, now);
  }
  room.floor = { who: name, since: now };
  room.speakingUntil[name] = now + speechMs(text) + WARMUP_MS;
  return addLine(room, { kind: "agent", who: name, text }, now);
}

/** The owner started talking: everyone speaking stops (by name; `uids` adds voices the page hears). Returns the names to interrupt. */
export function hush(room, { uids = [], ownerLabel = "the owner", now = Date.now() } = {}) {
  const byUid = new Map(castNames(room).map((n) => [Number(room.cast[n]?.uid), n]));
  const names = new Set(castNames(room).filter((n) => (room.speakingUntil[n] || 0) > now));
  for (const u of uids) if (byUid.has(Number(u))) names.add(byUid.get(Number(u)));
  for (const n of names) {
    room.speakingUntil[n] = 0;
    addLine(room, { kind: "note", who: n, text: `[${n} was interrupted by ${ownerLabel}]` }, now);
  }
  room.floor = { who: "human", since: now };
  room.agentRun = 0;
  room.hushedAt = now;
  room.hushSeq = ++room.seq;
  return [...names];
}

/**
 * Who may jump in now: nobody while the owner holds the floor, while an agent is still thinking, after
 * MAX_AGENT_RUN agent turns in a row, or during another jump-in; never the agent that spoke last.
 */
export function jumpInCandidates(room, live, now = Date.now()) {
  if (room.jumping || room.agentRun >= MAX_AGENT_RUN) return [];
  if (floorOf(room, now)?.who === "human") return [];
  if (live.some((n) => (room.thinking[n] || 0) > 0)) return [];
  return live.filter((n) => n !== room.lastAgent);
}

const label = (l, ownerName) => (l.kind === "human" ? ownerName : l.kind === "host" ? "Slates (host)" : l.who);

/** The last `n` lines as "Name: text", notes as they are. */
export function transcriptTail(room, { n = 12, ownerName = "The owner" } = {}) {
  return (room?.transcript || [])
    .slice(-n)
    .map((l) => (l.kind === "note" ? l.text : `${label(l, ownerName)}: ${l.text}`))
    .join("\n");
}

/** What the UI needs. Caption `who`: You, Slates, or the agent's name. */
export function roomState(room, now = Date.now(), n = 30) {
  const f = floorOf(room, now);
  return {
    channel: room.channel,
    transcript: room.transcript.slice(-n).map((l) => ({ kind: l.kind, who: l.kind === "human" ? "You" : l.kind === "host" ? "Slates" : l.who, text: l.text, at: l.at })),
    floor: f ? { who: f.who === "human" ? "You" : f.who, since: f.since } : null,
    status: Object.fromEntries(castNames(room).map((name) => [name, statusOf(room, name, now)])),
    agentRun: room.agentRun,
  };
}

// ---------- syncing the host's history ----------

const key = (l) => `${l.who}\u0000${l.text}`;

/**
 * The lines of `incoming` (the host's current caption window) not seen in `prev` (the last window): the window
 * slides, so find where the end of `prev` overlaps the start of `incoming`.
 */
export function diffHistory(prev, incoming) {
  const a = prev.map(key);
  const b = incoming.map(key);
  for (let i = 0; i < a.length; i++) {
    const tail = a.slice(i);
    if (tail.length <= b.length && tail.every((k, j) => k === b[j])) return incoming.slice(tail.length);
  }
  return incoming.slice();
}

/** "You"/"Slates" (any case) → { kind, who }; anything else (agents speak only through the runner) → null. */
export function eventKind(who) {
  const w = String(who || "").trim().toLowerCase();
  if (HUMAN_WHO.has(w)) return { kind: "human", who: "You" };
  if (HOST_WHO.has(w)) return { kind: "host", who: "Slates" };
  return null;
}

const cleanLines = (xs) => (Array.isArray(xs) ? xs.slice(-60) : [])
  .map((l) => ({ ev: eventKind(l?.who), text: typeof l?.text === "string" ? l.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "" }))
  .filter((l) => l.ev && l.text)
  .map((l) => ({ ...l.ev, text: l.text }));

/** Apply a /room/event body. Returns the new lines (owner and host) that were appended. */
export function applyEvent(room, body, now = Date.now()) {
  const added = [];
  if (body?.host && typeof body.host.agentId === "string" && body.host.agentId.length <= 200) room.host = { agentId: body.host.agentId };
  if (Array.isArray(body?.history)) {
    const incoming = cleanLines(body.history);
    for (const l of diffHistory(room.historySeen, incoming)) {
      const line = addLine(room, l, now);
      if (line) added.push(line);
    }
    room.historySeen = incoming.slice(-60);
  }
  for (const l of cleanLines(body?.lines)) {
    const line = addLine(room, l, now);
    if (line) added.push(line);
  }
  return added;
}

// ---------- jump-in moderator ----------

export function moderatorPrompt({ tail, last, candidates, roles = AGENT_ROLES }) {
  return [
    "You moderate a live voice meeting between the owner, Slates (the host) and the owner's AI agents.",
    `${last} just finished speaking. Decide if ONE of these agents should briefly jump in to add something useful, correct a mistake, or disagree:`,
    ...candidates.map((c) => `- ${c}: ${roles[c] || "an AI agent"}`),
    "Only pick one if it clearly adds value: a fact, a correction, a real disagreement or a missing next step. Small talk, greetings, goodbyes, a question to the owner, or a turn that fully answered it: nobody.",
    'Reply with JSON only: {"agent": "<name>"} or {"agent": null}.',
    "",
    "Meeting so far:",
    tail || "(nothing yet)",
  ].join("\n");
}

/** The moderator's reply → one of `candidates`, or null. Accepts JSON, a bare name, or "none". */
export function parseModeratorDecision(text, candidates) {
  const s = String(text || "").trim();
  if (!s) return null;
  let pick;
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      pick = j.agent ?? j.name ?? null;
    } catch {}
  }
  if (pick === undefined) pick = s.replace(/^["'`\s]+|["'`.\s]+$/g, "");
  if (typeof pick !== "string") return null;
  const p = pick.trim().toLowerCase();
  return candidates.find((c) => c.toLowerCase() === p) || null;
}

/** Gemini over REST (cheap, fast). Returns async (prompt, signal) → text | null. Null when no key. */
export function geminiModerator(env, { fetchImpl = fetch, model = env.MODERATOR_MODEL || "gemini-3.5-flash-lite", log = () => {} } = {}) {
  if (!env.GEMINI_API_KEY) return null;
  return async (prompt, signal) => {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 40, responseMimeType: "application/json" },
      }),
      signal,
    });
    if (!res.ok) {
      log(`  moderator: Gemini ${res.status}`);
      return null;
    }
    const j = await res.json().catch(() => ({}));
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim() || null;
  };
}

/** Ask the moderator who should jump in; null on no, error, or after `timeoutMs` (then the room just carries on). */
export async function decideJumpIn({ moderate, tail, last, candidates, timeoutMs = 3000 }) {
  if (!moderate || !candidates.length) return null;
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => { ac.abort(); r(null); }, timeoutMs); });
  try {
    const text = await Promise.race([
      Promise.resolve().then(() => moderate(moderatorPrompt({ tail, last, candidates }), ac.signal)).catch(() => null),
      timeout,
    ]);
    return parseModeratorDecision(text, candidates);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- agent prompts ----------

export function jumpInPrompt({ agent, last, ownerName = "the owner", tail }) {
  return [
    `You are ${agent}, one of ${ownerName}'s AI agents, in a live voice meeting with ${ownerName}, Slates (the host) and other agents. What you say is spoken aloud.`,
    "",
    "Here is the meeting so far:",
    tail || "(nothing yet)",
    "",
    `Jump in briefly if you have something useful to add to ${last}'s point: add a fact, correct a mistake, or disagree, and name ${last} when you do. At most 2 short spoken sentences, plain words, no markdown. You may read the user's Slates with your Slates tools; do not change anything.`,
    "If you have nothing genuinely useful to add, reply with exactly: PASS",
  ].join("\n");
}

/** The agent declined to jump in. */
export const isPass = (text) => /^\W*pass\W*$/i.test(String(text || "").trim());

// ---------- HTTP ----------

const sameSecret = (auth, secret) => {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(String(auth || ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

/**
 * verify(ctx) → { channel, cast } | null. interrupt({ channel, agentId, uid }) → boolean.
 * onEvent(room, payload, added) is called after owner/host lines arrive (the jump-in moderator).
 */
export function createRoomHandler({ secret, rooms, verify, interrupt = async () => false, onEvent = () => {}, ownerLabel = "the owner", log = () => {}, now = () => Date.now() }) {
  async function handle(req, res) {
    const u = new URL(req.url, "http://x");
    if (!u.pathname.startsWith("/room/")) return false;
    const json = (code, body) => { if (!res.headersSent) res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body)); };
    try {
      const route = u.pathname.slice("/room/".length);
      if (!["event", "hush", "state"].includes(route)) { json(404, { ok: false, error: "not found" }); return true; }
      const method = route === "state" ? "GET" : "POST";
      if (req.method !== method) { json(405, { ok: false, error: `use ${method}` }); return true; }
      if (!secret) { json(503, { ok: false, error: "rooms are not set up" }); return true; }
      if (!sameSecret(req.headers.authorization, secret)) { json(401, { ok: false, error: "unauthorized" }); return true; }
      let body = {};
      if (method === "POST") {
        let raw = "";
        for await (const c of req) {
          raw += c;
          if (raw.length > MAX_BODY) { json(413, { ok: false, error: "too large" }); return true; }
        }
        try { body = JSON.parse(raw); } catch { json(400, { ok: false, error: "bad json" }); return true; }
        if (!body || typeof body !== "object") { json(400, { ok: false, error: "bad json" }); return true; }
      }
      const payload = verify(method === "GET" ? u.searchParams.get("ctx") : body.ctx);
      if (!payload) { json(401, { ok: false, error: "bad ctx" }); return true; }
      const room = rooms.get(payload.channel, payload.cast);
      const t = now();
      if (route === "event") {
        const added = applyEvent(room, body, t);
        if (added.length) Promise.resolve().then(() => onEvent(room, payload, added)).catch((err) => log(`  room event: ${err.message}`));
        json(200, { ok: true, added: added.length, state: roomState(room, t) });
      } else if (route === "hush") {
        const uids = Array.isArray(body.uids) ? body.uids.filter((x) => Number.isInteger(x)).slice(0, 8) : [];
        const names = hush(room, { uids, ownerLabel, now: t });
        const results = await Promise.all(names.map(async (name) => {
          const c = room.cast[name];
          if (!c?.agentId) return false;
          return Promise.resolve(interrupt({ channel: room.channel, agentId: c.agentId, uid: Number(c.uid) })).catch(() => false);
        }));
        if (names.length) log(`🎙  hush: ${names.map((n, i) => `${n}${results[i] ? "" : " (interrupt failed)"}`).join(", ")}`);
        json(200, { ok: true, interrupted: names, state: roomState(room, t) });
      } else {
        json(200, { ok: true, state: roomState(room, t) });
      }
    } catch (err) {
      log(`🎙  room error: ${err.message}`);
      json(500, { ok: false, error: "room error" });
    }
    return true;
  }
  return { handle };
}
