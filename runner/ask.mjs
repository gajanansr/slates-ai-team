// Live "ask an agent": during a voice call, Agora's host agent calls POST /ask and one of the owner's REAL coding
// agents (Claude Code, OpenAI Codex CLI, Google Antigravity CLI) answers, reading the owner's Slates for context.
// If the call context names that agent's speak-only voice in the room, the runner makes it say the answer itself.
//
// Request:  POST /ask  Authorization: Bearer <ASK_SECRET>
//           { agent: "Claude"|"Codex"|"Antigravity", question, ctx, tool_call_id }
// Response: { ok: true, agent, answer, spoken } | { ok: false, agent, answer }   (always JSON)
//
// ctx = base64url(JSON payload) + "." + base64url(HMAC-SHA256(ASK_SECRET, base64url(JSON payload)))
// payload = { channel, cast: { [agentName]: { agentId, uid } }, exp: unixSeconds }

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildAgentCommand, buildMcpConfig, extractResultText } from "./lib.mjs";
import { fitSpeech } from "./agora.mjs";
import {
  createRooms, createRoomHandler, transcriptTail, setThinking, speakersToInterrupt, takeFloor, floorOf, addLine,
  jumpInCandidates, decideJumpIn, jumpInPrompt, isPass, castNames, ownerActedSince, MAX_AGENT_RUN,
} from "./room.mjs";

const require = createRequire(import.meta.url);

export const ASK_AGENTS = ["Claude", "Codex", "Antigravity"];
// Slates tools the live agents may use: read only.
export const SLATES_READ_TOOLS = ["get_about_me", "check_desk", "list_slates", "get_slate", "search", "find_notes", "get_note", "recent_activity", "what_changed"];
const AGORA_API = "https://api.agora.io/api/conversational-ai-agent/v2/projects";
const MAX_BODY = 64 * 1024;
/** The host's (Slates') uid in every call channel. */
export const HOST_UID = 1000;

// ---------- ctx token ----------

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (secret, data) => crypto.createHmac("sha256", String(secret)).update(data).digest();

export function signAskCtx(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(hmac(secret, body))}`;
}

// Returns the payload, or null if the token is missing, malformed, tampered with or expired.
export function verifyAskCtx(token, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!token || !secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const want = hmac(secret, parts[0]);
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try {
    p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || typeof p.channel !== "string" || !p.channel) return null;
  if (!Number.isFinite(p.exp) || p.exp <= nowSec) return null;
  if (p.cast != null && typeof p.cast !== "object") return null;
  return { channel: p.channel, cast: p.cast || {}, exp: p.exp };
}

// The cast entry for an agent, if it is usable for speaking.
export function castFor(ctx, agent) {
  const c = ctx?.cast?.[agent];
  if (!c || typeof c.agentId !== "string" || !c.agentId || !Number.isInteger(Number(c.uid))) return null;
  return { agentId: c.agentId, uid: Number(c.uid) };
}

// ---------- prompt and output cleaning ----------

export function askPrompt({ agent, question, ownerName = "the owner", transcript = "" }) {
  return [
    `You are ${agent}, one of ${ownerName}'s AI agents. ${ownerName}, the owner, is asking you this live on a voice call, and your answer will be spoken aloud.`,
    ...(transcript
      ? [
          "",
          "Here is the meeting so far (the owner, Slates the host, and the other agents):",
          transcript,
          "",
          `You are ${agent}. Reply to the question; you may agree or disagree with the others by name. If you were interrupted, don't repeat yourself.`,
        ]
      : []),
    "",
    `Question: ${question}`,
    "",
    "Answer in at most 3 short spoken sentences, plain words, no markdown/code/lists. You may read the user's Slates (boards, desk, notes) with your Slates tools to answer. Do not change anything unless the question explicitly asks you to.",
  ].join("\n");
}

// Strip what a pseudo-terminal adds: ANSI/OSC escapes, ^D echo, backspaces, carriage returns.
export function cleanTerminalOutput(s) {
  return String(s || "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/\^D/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

// agy -p --output-format json prints {"status":"SUCCESS","response":"..."}; fall back to the plain text.
export function parseAgyOutput(raw) {
  const s = cleanTerminalOutput(raw);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(s.slice(start, end + 1));
      if (typeof j.response === "string") return { ok: j.status ? j.status === "SUCCESS" : true, text: j.response.trim() };
    } catch {}
  }
  return { ok: Boolean(s), text: s };
}

// Make any answer safe to say: no markdown, one paragraph, at most `max` chars (cut at a sentence end if possible).
export function spokenAnswer(text, max = 600) {
  let t = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, "")
    .replace(/(\*\*|__|~~|\*)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  t = t.slice(0, max);
  const end = Math.max(t.lastIndexOf(". "), t.lastIndexOf("? "), t.lastIndexOf("! "), t.endsWith(".") ? t.length - 1 : -1);
  return end > 120 ? t.slice(0, end + 1) : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

export function looksSignedOut(text) {
  return /not logged in|please (log|sign) ?in|`?codex login`?|unauthori[sz]ed|\b401\b|authentication required/i.test(String(text || ""));
}

// ---------- the HTTP handler ----------

function semaphore(n) {
  let active = 0;
  const waiting = [];
  return async () => {
    if (active >= n) await new Promise((r) => waiting.push(r));
    active++;
    return () => { active--; waiting.shift()?.(); };
  };
}

// runAgent(agent, prompt, { signal, timeoutMs }) → { ok, text, error?: "signed_out"|"missing"|"failed" }
// speak({ channel, agentId, uid, text }) → boolean;  interrupt({ channel, agentId, uid }) → boolean
// moderate(prompt, signal) → text | null   (the jump-in moderator; null/absent = agents never jump in)
export function createAskHandler({
  secret, runAgent, speak = async () => false, interrupt = async () => false, moderate = null,
  available = ASK_AGENTS, ownerName = "the owner",
  timeoutMs = 75_000, deadlineMs = 85_000, maxConcurrent = 2, log = () => {}, now = () => Date.now(),
  rooms = createRooms({ now }), moderatorTimeoutMs = 3000, jumpTimeoutMs = 45_000, humanWaitMs = 4000,
  jumpAfterHost = true, hostInterruptWindowMs = 15_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const slot = semaphore(maxConcurrent);
  const perAgent = new Map(); // agent → promise chain (one in flight per agent)
  const background = new Set();
  const bg = (fn) => {
    const p = Promise.resolve().then(fn).catch((err) => log(`🎙  room: ${err.message}`));
    background.add(p);
    p.finally(() => background.delete(p));
  };

  // Run one agent's CLI: one run per agent at a time, then one of `maxConcurrent` slots, within the time left.
  async function runQueued(agent, prompt, started, limitMs) {
    const prev = perAgent.get(agent) || Promise.resolve();
    let releaseAgent;
    const mine = new Promise((r) => { releaseAgent = r; });
    const chain = prev.then(() => mine);
    perAgent.set(agent, chain);
    await prev;
    const releaseSlot = await slot();
    try {
      const budget = Math.min(timeoutMs, limitMs - (now() - started));
      if (budget < 5000) return { busy: true };
      const ac = new AbortController();
      let timer;
      const timedOut = new Promise((r) => { timer = setTimeout(() => { ac.abort(); r({ timeout: true, budget }); }, budget); });
      const result = await Promise.race([
        Promise.resolve().then(() => runAgent(agent, prompt, { signal: ac.signal, timeoutMs: budget }))
          .catch((err) => ({ ok: false, error: "failed", text: err.message })),
        timedOut,
      ]);
      clearTimeout(timer);
      return result;
    } finally {
      releaseSlot();
      releaseAgent();
      if (perAgent.get(agent) === chain) perAgent.delete(agent);
    }
  }

  // Say `text` in `agent`'s voice, taking the floor: the owner wins, whoever else is speaking is interrupted first.
  // A jump-in is dropped if the owner spoke or barged in since it started.
  async function deliver(room, agent, text, { jump = false, sinceSeq = 0 } = {}) {
    const who = castFor({ cast: room.cast }, agent);
    if (!who) return false;
    if (floorOf(room, now())?.who === "human") {
      if (jump) return false;
      const until = now() + humanWaitMs;
      while (floorOf(room, now())?.who === "human" && now() < until) await sleep(200);
    }
    if (jump && ownerActedSince(room, sinceSeq)) return false;
    const stop = speakersToInterrupt(room, agent, now());
    const calls = stop.map((n) => {
      const c = castFor({ cast: room.cast }, n);
      return c ? Promise.resolve(interrupt({ channel: room.channel, agentId: c.agentId, uid: c.uid })).catch(() => false) : false;
    });
    // A jump-in may land while Slates is still talking; a direct ask never (the host is waiting on its ask_agent call).
    if (jump && room.host?.agentId && now() - room.hostAt < hostInterruptWindowMs) {
      calls.push(Promise.resolve(interrupt({ channel: room.channel, agentId: room.host.agentId, uid: HOST_UID })).catch(() => false));
    }
    await Promise.all(calls);
    if (stop.length) log(`🎙  ${agent} takes the floor from ${stop.join(", ")}`);
    const spoken = await Promise.resolve(speak({ channel: room.channel, agentId: who.agentId, uid: who.uid, text: fitSpeech(text) })).catch(() => false) === true;
    if (spoken) takeFloor(room, agent, text, { interrupted: stop, now: now() });
    return spoken;
  }

  // After a turn (an agent's or the host's): the moderator may let one other live agent jump in.
  async function afterTurn(room, last) {
    if (!moderate) return;
    const live = castNames(room).filter((n) => available.includes(n) && castFor({ cast: room.cast }, n));
    const candidates = jumpInCandidates(room, live, now());
    if (!candidates.length) return;
    room.jumping = true;
    const startedAt = now();
    const sinceSeq = room.seq;
    let spokeAs = null;
    try {
      const tail = transcriptTail(room, { ownerName });
      const pick = await decideJumpIn({ moderate, tail, last, candidates, timeoutMs: moderatorTimeoutMs });
      log(`🎙  moderator after ${last}: ${pick || "nobody"} (${now() - startedAt}ms)`);
      if (!pick) return;
      setThinking(room, pick, true);
      let result;
      try {
        result = await runQueued(pick, jumpInPrompt({ agent: pick, last, ownerName, tail }), now(), jumpTimeoutMs);
      } finally {
        setThinking(room, pick, false);
      }
      if (!result?.ok || !String(result.text || "").trim()) return log(`🎙  ${pick} jump-in: no answer`);
      if (isPass(result.text)) return log(`🎙  ${pick} passed (${((now() - startedAt) / 1000).toFixed(1)}s)`);
      if (room.agentRun >= MAX_AGENT_RUN || room.lastAgent === pick) return log(`🎙  ${pick} jump-in dropped (turn rules)`);
      const spoken = await deliver(room, pick, spokenAnswer(result.text, 400), { jump: true, sinceSeq });
      log(`🎙  ${pick} jumped in after ${last} in ${((now() - startedAt) / 1000).toFixed(1)}s${spoken ? "" : " (not spoken: the owner has the floor or speak failed)"}`);
      if (spoken) spokeAs = pick;
    } finally {
      room.jumping = false;
    }
    if (spokeAs) bg(() => afterTurn(room, spokeAs));
  }

  // New owner/host lines from the web app: after a real host turn, someone may jump in.
  function onEvent(room, _payload, added) {
    if (!jumpAfterHost) return;
    const last = added[added.length - 1];
    if (last?.kind !== "host" || /^\s*asking\b/i.test(last.text)) return;
    if (!room.transcript.some((l) => l.kind === "human")) return;
    bg(() => afterTurn(room, "Slates"));
  }

  const roomHandler = createRoomHandler({ secret, rooms, verify: (t) => verifyAskCtx(t, secret), interrupt, onEvent, ownerLabel: ownerName, log, now });

  async function ask({ agent, question, ctx }) {
    const started = now();
    const sorry = (answer) => ({ ok: false, agent, answer });
    if (!ASK_AGENTS.includes(agent)) return { ok: false, agent: String(agent || ""), answer: `I can only ask ${ASK_AGENTS.join(", ")}.` };
    if (!available.includes(agent)) return sorry(`${agent} isn't set up on this laptop yet.`);
    const q = String(question || "").trim().slice(0, 2000);
    if (!q) return sorry(`What should I ask ${agent}?`);
    const payload = verifyAskCtx(ctx, secret);
    const room = payload ? rooms.get(payload.channel, payload.cast) : null;
    const transcript = room ? transcriptTail(room, { ownerName }) : "";

    let spokeTurn = false;
    let thinking = Boolean(room);
    const doneThinking = () => { if (thinking) { thinking = false; setThinking(room, agent, false); } };
    if (room) setThinking(room, agent, true);
    try {
      const result = await runQueued(agent, askPrompt({ agent, question: q, ownerName, transcript }), started, deadlineMs);
      if (result.busy) return sorry(`${agent} is busy with another question; ask again in a moment.`);
      if (result.timeout) {
        log(`🎙  ask ${agent}: timed out after ${Math.round(result.budget / 1000)}s`);
        return sorry(`${agent} is still thinking; I'll put the answer on your desk.`);
      }
      if (!result.ok || !String(result.text || "").trim()) {
        log(`🎙  ask ${agent}: failed (${result.error || "no answer"}) ${String(result.text || "").slice(0, 200)}`);
        if (result.error === "signed_out") return sorry(`${agent} isn't signed in on this laptop yet.`);
        if (result.error === "missing") return sorry(`${agent} isn't installed on this laptop.`);
        return sorry(`Sorry, ${agent} couldn't answer that right now.`);
      }
      const answer = spokenAnswer(result.text);
      doneThinking();
      let spoken = false;
      if (room && castFor(payload, agent)) {
        spoken = await deliver(room, agent, answer);
        spokeTurn = spoken;
      }
      // Not spoken: the host relays it, so it is still part of the meeting.
      if (room && !spoken) addLine(room, { kind: "agent", who: agent, text: answer }, now());
      log(`🎙  ask ${agent}: answered in ${((now() - started) / 1000).toFixed(1)}s${castFor(payload, agent) ? (spoken ? ", spoken in the call" : ", speak failed") : ""}`);
      return { ok: true, agent, answer, spoken };
    } finally {
      doneThinking();
      if (spokeTurn) bg(() => afterTurn(room, agent));
    }
  }

  // Node http handler. Returns true if it handled the request.
  async function handle(req, res) {
    if (await roomHandler.handle(req, res)) return true;
    const u = new URL(req.url, "http://x");
    if (u.pathname !== "/ask") return false;
    const json = (code, body) => { if (!res.headersSent) res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body)); };
    try {
      if (req.method !== "POST") { json(405, { ok: false, error: "use POST" }); return true; }
      if (!secret) { json(503, { ok: false, answer: "Live agents aren't set up on the runner." }); return true; }
      const auth = String(req.headers.authorization || "");
      const want = Buffer.from(`Bearer ${secret}`);
      const got = Buffer.from(auth);
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) { json(401, { ok: false, error: "unauthorized" }); return true; }
      let raw = "";
      for await (const c of req) {
        raw += c;
        if (raw.length > MAX_BODY) { json(413, { ok: false, answer: "That question was too long." }); return true; }
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(400, { ok: false, answer: "I couldn't read that question." });
        return true;
      }
      if (!body || typeof body !== "object") { json(400, { ok: false, answer: "I couldn't read that question." }); return true; }
      json(200, await ask(body));
    } catch (err) {
      log(`🎙  ask error: ${err.message}`);
      json(500, { ok: false, agent: "", answer: "Sorry, something went wrong asking that agent." });
    }
    return true;
  }

  /** Resolves once background work (moderator, jump-ins) has finished. For tests and shutdown. */
  async function idle() {
    while (background.size) await Promise.allSettled([...background]);
  }

  return { handle, ask, afterTurn, rooms, idle };
}

// ---------- speaking in the call (Agora) ----------

export function agoraSpeaker(env, { fetchImpl = fetch, timeoutMs = 8000, log = () => {} } = {}) {
  return async ({ channel, agentId, uid, text }) => {
    if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE) return false;
    try {
      const { ConvoAITokenBuilder } = require("agora-token");
      const token = ConvoAITokenBuilder.buildToken(env.AGORA_APP_ID, env.AGORA_APP_CERTIFICATE, channel, String(uid), 600, 600);
      const res = await fetchImpl(`${AGORA_API}/${env.AGORA_APP_ID}/agents/${encodeURIComponent(agentId)}/speak`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `agora token="${token}"` },
        body: JSON.stringify({ text: fitSpeech(text), priority: "INTERRUPT", interruptable: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) log(`  speak ${agentId}: Agora ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return res.status === 200;
    } catch (err) {
      log(`  speak ${agentId} failed: ${err.message}`);
      return false;
    }
  };
}

// Stop an agent's current speech (or thinking) in the call: Agora's /interrupt, empty body.
export function agoraInterrupter(env, { fetchImpl = fetch, timeoutMs = 5000, log = () => {} } = {}) {
  return async ({ channel, agentId, uid }) => {
    if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE) return false;
    try {
      const { ConvoAITokenBuilder } = require("agora-token");
      const token = ConvoAITokenBuilder.buildToken(env.AGORA_APP_ID, env.AGORA_APP_CERTIFICATE, channel, String(uid), 600, 600);
      const res = await fetchImpl(`${AGORA_API}/${env.AGORA_APP_ID}/agents/${encodeURIComponent(agentId)}/interrupt`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `agora token="${token}"` },
        body: "{}",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) log(`  interrupt ${agentId}: Agora ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return res.status === 200;
    } catch (err) {
      log(`  interrupt ${agentId} failed: ${err.message}`);
      return false;
    }
  };
}

// ---------- running the real agents ----------

// Run a process, kill it on abort or timeout. Never rejects.
export function runProcess(bin, args, { cwd, env, signal, timeoutMs = 75_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    } catch (err) {
      return resolve({ code: -1, stdout: "", stderr: err.message, timedOut: false, missing: err.code === "ENOENT" });
    }
    let stdout = "", stderr = "", timedOut = false, done = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const kill = () => {
      // Kill the whole group: `script` wraps agy, codex spawns helpers.
      try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
      setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 2000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const onAbort = () => { timedOut = true; kill(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (code, extra = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, ...extra });
    };
    child.on("close", (code) => finish(code));
    child.on("error", (err) => { stderr += err.message; finish(-1, { missing: err.code === "ENOENT" }); });
  });
}

// Command lines for each agent (pure; tested).
export function claudeAskCommand({ bin = "claude", model = "claude-haiku-5-5", prompt, mcpFile, maxBudgetUsd = "0.5" }) {
  return buildAgentCommand(
    { kind: "claude", bin, model, maxBudgetUsd: String(maxBudgetUsd), allowedTools: SLATES_READ_TOOLS.map((t) => `mcp__slates__${t}`) },
    { prompt, mcpFile, workdir: "" },
  );
}

export function codexAskCommand({ bin = "codex", prompt, slatesUrl, lastFile, model = "gpt-6-luna", effort = "low" }) {
  const toml = (v) => JSON.stringify(v); // JSON strings/arrays are valid TOML
  const args = [
    "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--color", "never",
    "-c", `approval_policy=${toml("never")}`,
    "-c", `model_reasoning_effort=${toml(effort)}`,
    // ChatGPT-account connectors (codex_apps) would bring Slates write tools too; use only our read-only server.
    "--disable", "apps",
    "-c", `mcp_servers.slates.url=${toml(slatesUrl)}`,
    // The token stays in the environment, never on the command line.
    "-c", `mcp_servers.slates.bearer_token_env_var=${toml("SLATES_TOKEN")}`,
    "-c", `mcp_servers.slates.enabled_tools=${toml(SLATES_READ_TOOLS)}`,
    "-o", lastFile,
  ];
  if (model) args.push("-m", model);
  args.push(prompt);
  return { bin, args };
}

// agy hangs without a TTY, so it runs inside `script` (a pseudo-terminal).
export function agyAskCommand({ bin = "agy", prompt, model = "gemini-3.8-flash-low", platform = process.platform }) {
  const agy = [bin, "-p", prompt, "--output-format", "json", ...(model ? ["--model", model] : [])];
  if (platform === "darwin") return { bin: "script", args: ["-q", "/dev/null", ...agy] };
  const sh = agy.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(" ");
  return { bin: "script", args: ["-qec", sh, "/dev/null"] };
}

// Workspace MCP config for agy: <cwd>/.agents/mcp_config.json (read tools only).
export function agyMcpConfig({ slatesUrl, token }) {
  return { mcpServers: { slates: { serverUrl: slatesUrl, headers: { Authorization: `Bearer ${token}` }, enabledTools: SLATES_READ_TOOLS } } };
}

const which = (bin) => {
  if (bin.includes("/")) return fs.existsSync(bin) ? bin : null;
  const r = spawnSync("/bin/sh", ["-c", `command -v "$0"`, bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

export function resolveBins(env) {
  const home = os.homedir();
  const agy = env.AGY_BIN || which("agy") || (fs.existsSync(path.join(home, ".local/bin/agy")) ? path.join(home, ".local/bin/agy") : null);
  return { claude: env.CLAUDE_BIN || "claude", codex: env.CODEX_BIN || which("codex"), agy };
}

// Which live agents can answer on this machine. Claude always; Codex if installed and signed in; Antigravity if agy exists.
export function detectAskAgents(env, { bins = resolveBins(env), run = spawnSync } = {}) {
  const list = ["Claude"];
  if (bins.codex) {
    const v = run(bins.codex, ["--version"], { encoding: "utf8", timeout: 10_000 });
    const s = v.status === 0 ? run(bins.codex, ["login", "status"], { encoding: "utf8", timeout: 10_000 }) : null;
    if (s && s.status === 0 && !/not logged in/i.test(`${s.stdout}${s.stderr}`)) list.push("Codex");
  }
  if (bins.agy) list.push("Antigravity");
  return list;
}

// The real runner: one temp dir per ask (0700), configs 0600, removed afterwards so the token never stays on disk.
export function createAgentRunner(env, { slatesUrl, token, bins = resolveBins(env), tmpRoot = os.tmpdir(), run = runProcess, log = () => {} }) {
  return async (agent, prompt, { signal, timeoutMs = 75_000 } = {}) => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "slates-ask-"));
    fs.chmodSync(dir, 0o700);
    const childEnv = { ...env, SLATES_MCP_URL: slatesUrl, SLATES_TOKEN: token };
    try {
      const t0 = Date.now();
      let r, text, ok;
      if (agent === "Claude") {
        const mcpFile = path.join(dir, ".slates-mcp.json");
        fs.writeFileSync(mcpFile, JSON.stringify(buildMcpConfig({ slatesUrl, token })), { mode: 0o600 });
        const { bin, args } = claudeAskCommand({ bin: bins.claude, model: env.CLAUDE_ASK_MODEL || "claude-haiku-5-5", prompt, mcpFile, maxBudgetUsd: env.ASK_MAX_BUDGET_USD || "0.5" });
        r = await run(bin, args, { cwd: dir, env: childEnv, signal, timeoutMs });
        let isError = false;
        try { isError = JSON.parse(r.stdout).is_error === true; } catch {}
        text = extractResultText(r.stdout);
        ok = r.code === 0 && !isError;
      } else if (agent === "Codex") {
        if (!bins.codex) return { ok: false, error: "missing", text: "codex not found" };
        const lastFile = path.join(dir, "answer.txt");
        const { bin, args } = codexAskCommand({ bin: bins.codex, prompt, slatesUrl, lastFile, model: env.CODEX_MODEL || "gpt-6-luna", effort: env.CODEX_ASK_EFFORT || "low" });
        r = await run(bin, args, { cwd: dir, env: childEnv, signal, timeoutMs });
        text = fs.existsSync(lastFile) ? fs.readFileSync(lastFile, "utf8").trim() : "";
        ok = r.code === 0 && Boolean(text);
        if (!ok && looksSignedOut(`${r.stdout}\n${r.stderr}`)) return { ok: false, error: "signed_out", text: r.stderr.slice(-300) };
      } else if (agent === "Antigravity") {
        if (!bins.agy) return { ok: false, error: "missing", text: "agy not found" };
        fs.mkdirSync(path.join(dir, ".agents"), { mode: 0o700 });
        fs.writeFileSync(path.join(dir, ".agents", "mcp_config.json"), JSON.stringify(agyMcpConfig({ slatesUrl, token })), { mode: 0o600 });
        const { bin, args } = agyAskCommand({ bin: bins.agy, prompt, model: env.AGY_MODEL || "gemini-3.8-flash-low" });
        r = await run(bin, args, { cwd: dir, env: childEnv, signal, timeoutMs });
        const p = parseAgyOutput(r.stdout);
        text = p.text;
        ok = r.code === 0 && p.ok && Boolean(text);
      } else {
        return { ok: false, error: "failed", text: `unknown agent ${agent}` };
      }
      log(`  ask ${agent}: exit=${r.code} in ${((Date.now() - t0) / 1000).toFixed(1)}s${r.timedOut ? " (stopped)" : ""}`);
      if (r.missing) return { ok: false, error: "missing", text: r.stderr };
      return ok ? { ok: true, text } : { ok: false, error: "failed", text: `${text || ""} ${r.stderr || ""}`.trim().slice(-500) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
