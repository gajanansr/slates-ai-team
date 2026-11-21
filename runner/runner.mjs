#!/usr/bin/env node
// Slates runner: polls the Slates desk for each configured agent and runs that agent
// (Claude Code headless, or any command such as Codex) on new tasks.
//
//   node runner.mjs                     # loop forever
//   node runner.mjs --once              # one poll, then exit
//   node runner.mjs --dry-run           # show what it would run
//   node runner.mjs --include-existing  # also run tasks already waiting at first start
//
// Settings come from environment variables (or a .env file next to this script).
// See .env.example and agents.example.json.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tasksFromDesk, planPoll, buildPrompt, parseToolResult, summarizeClaudeOutput, activityMessage,
  loadAgents, buildAgentCommand, migrateState, mapLimit, safeName, oneLine,
  telegramMarker, parseTelegramMarker, parseAllowedChats, routeTelegramUpdate, extractResultText, telegramReplyText,
  approvalKeyboard, parseApprovalData, approvalPromptText, approvalResultText,
  browserToolsOn, buildMcpConfig, extraAllowedTools,
} from "./lib.mjs";
import { STATUS, applyWorkUpdate, workBoardCreateArgs, resultLine, short, WORK_BOARD } from "./work-board.mjs";
import { telegramClient } from "./telegram.mjs";
import { createNtfy } from "./ntfy.mjs";
import { createTwilio } from "./twilio.mjs";
import { checkCall, disclosureGreeting, callApprovalQuestion, callNote, createCallProvider } from "./calls.mjs";
import { parseWatchers, stepWatcher, minutesBetween, INCIDENT_COLUMNS, incidentRow, incidentSlug, incidentTask, parseIncidentMarker } from "./watchers.mjs";
import { createAskHandler, createAgentRunner, agoraSpeaker, agoraInterrupter, detectAskAgents } from "./ask.mjs";
import { geminiModerator } from "./room.mjs";
import { validateGroup, tally, groupApprovalQuestion, groupApprovalDetails, boardData, boardRow, groupSummaryNote } from "./group.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (process.env.RUNNER_NO_DOTENV !== "1") loadDotEnv(path.join(HERE, ".env")); // tests set this so they never touch real tokens

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const DRY_RUN = args.has("--dry-run");
const INCLUDE_EXISTING = args.has("--include-existing");

const cfg = {
  url: process.env.SLATES_MCP_URL || "https://www.slates.space/mcp",
  pollSeconds: num(process.env.POLL_SECONDS, 60),
  workDir: path.resolve(HERE, process.env.WORK_DIR || "work"),
  stateFile: path.resolve(HERE, process.env.STATE_FILE || "state.json"),
  timeoutMin: num(process.env.TASK_TIMEOUT_MIN, 30),
  maxConcurrent: num(process.env.MAX_CONCURRENT, 2),
  approvalTimeoutSec: num(process.env.APPROVAL_TIMEOUT_SEC, 600),
  ownerName: process.env.OWNER_NAME || "the owner",
  callMaxPerTask: num(process.env.CALL_MAX_PER_TASK, 3),
  callMaxMinutes: num(process.env.CALL_MAX_MINUTES, 5),
  callQuietHours: process.env.CALL_QUIET_HOURS ?? "21-9",
  callTimeZone: process.env.CALL_TIMEZONE || undefined,
  callAllowedPrefixes: (process.env.CALL_ALLOWED_PREFIXES || "").split(/[\s,]+/).filter(Boolean),
  groupMaxPeople: num(process.env.GROUP_MAX_PEOPLE, 8),
};

let agents;
try {
  const file = process.env.AGENTS_FILE ? fs.readFileSync(path.resolve(HERE, process.env.AGENTS_FILE), "utf8") : null;
  agents = loadAgents(process.env, file);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Optional Telegram front door (only when TELEGRAM_BOT_TOKEN is set).
const tg = process.env.TELEGRAM_BOT_TOKEN
  ? {
      client: telegramClient({ token: process.env.TELEGRAM_BOT_TOKEN, apiBase: process.env.TELEGRAM_API_BASE || undefined }),
      allowed: parseAllowedChats(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
      toAgent: process.env.TELEGRAM_TO_AGENT || agents[0].name,
      // Token used to create the Slates task. Its own identity is clearer, else the first agent's.
      slatesToken: process.env.SLATES_TOKEN_TELEGRAM || agents[0].token,
    }
  : null;

let state = null; // loaded in main(); shared by the desk loop and the Telegram loop
let wake = false; // set by Telegram so the desk is checked right away
// Tasks the runner creates itself (Telegram, watchers). Slates hides an agent's handoffs to itself from its own desk,
// so these are queued here directly; the handoff is still posted so the work is visible in Slates.
const localQueue = [];
function queueLocal(agent, created, t) {
  const r = created || {};
  const id = r.id || r.handoff?.id || r.item?.id || `local-${crypto.randomBytes(5).toString("hex")}`;
  localQueue.push({ agent, t: { id, kind: "handoff", ...t } });
  wake = true;
  return id;
}

// Approvals on Telegram: on when Telegram is set up with at least one allowed chat.
const approvalsOn = Boolean(tg && tg.allowed.size > 0 && process.env.APPROVALS !== "false");
const approval = { url: "", secret: crypto.randomBytes(24).toString("hex"), pending: new Map(), taskChats: new Map() };

// Phone calls: only with approvals on (every call needs the owner's Yes) and a CALL_PROVIDER.
const callProvider = approvalsOn ? createCallProvider(process.env) : null;
const callsOn = Boolean(callProvider);
const calls = { url: "", groupUrl: "", decideUrl: "", geminiUrl: "", perTask: new Map(), saidYes: new Map(), inflight: new Map() };
const geminiOn = Boolean(process.env.GEMINI_API_KEY);
// A real browser for Claude (Microsoft's Playwright MCP server), only when BROWSER_TOOLS=1.
const browserOn = browserToolsOn(process.env);
const ntfy = createNtfy(process.env, { log: (m) => log(m) });
const twilio = createTwilio(process.env, { log: (m) => log(m) });
// Live "ask an agent" (POST /ask on the public call-page server): only when ASK_SECRET is set. Set up in main().
let askHandler = null;

// ---------- state: which desk items each agent has already handled ----------

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(cfg.stateFile, "utf8"));
  } catch {}
  const state = migrateState(raw, agents[0].name);
  if (raw && !raw.agents) saveState(state); // write the new shape once, right away
  return state;
}
function saveState(state) {
  fs.writeFileSync(cfg.stateFile, JSON.stringify(state, null, 2));
}

// ---------- Slates MCP ----------

async function withSlates(token, fn) {
  const client = new Client({ name: "slates-runner", version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

async function callTool(client, name, toolArgs = {}) {
  const res = await client.callTool({ name, arguments: toolArgs });
  const parsed = parseToolResult(res);
  if (res.isError) throw new Error(`${name} failed: ${parsed.text ?? JSON.stringify(parsed)}`);
  return parsed;
}

// Post to the Slates activity feed as this agent. Never let a reporting failure stop the runner.
async function report(agent, message) {
  if (DRY_RUN || process.env.REPORT_TO_SLATES === "false") return;
  try {
    await withSlates(agent.token, (c) => callTool(c, "log_activity", { message }));
  } catch (err) {
    log(`  (could not post to Slates activity: ${err.message})`);
  }
}

// ---------- "Agents at work" board ----------
// One pinned table board in Slates showing what every agent is doing right now (row id = desk task id).
// Best-effort: a failed write is logged and never affects the task. Writes run one at a time, so rows
// never race and the board is only created once.

const workBoardOn = process.env.WORK_BOARD !== "false";
const workTimeZone = process.env.CALL_TIMEZONE || "Asia/Kolkata";
let workChain = Promise.resolve();

function workUpdate(agent, taskId, patch) {
  if (DRY_RUN || !workBoardOn || !agent || !taskId || !state) return Promise.resolve();
  workChain = workChain
    .then(() => writeWorkRow(agent, String(taskId), patch))
    .catch((err) => log(`  (work board write failed: ${err.message})`));
  return workChain;
}

async function writeWorkRow(agent, id, patch) {
  state.workBoard ??= { rows: [] };
  const { rows, row, removed } = applyWorkUpdate(state.workBoard.rows, id, patch, { timeZone: workTimeZone });
  state.workBoard.rows = rows;
  saveState(state);
  await withSlates(agent.token, async (c) => {
    try {
      await callTool(c, "patch_items", { slug: WORK_BOARD.slug, upsert: [row], ...(removed.length ? { remove: removed } : {}) });
      return;
    } catch {}
    // Maybe only the trim failed (rows already gone): try the row alone before assuming there's no board.
    if (removed.length) {
      try {
        await callTool(c, "patch_items", { slug: WORK_BOARD.slug, upsert: [row] });
        return;
      } catch {}
    }
    await callTool(c, "create_slate", workBoardCreateArgs(rows));
  });
}

// ---------- running an agent ----------

function writeMcpConfig(dir, agent, t) {
  const file = path.join(dir, ".slates-mcp.json");
  const conf = buildMcpConfig({
    slatesUrl: cfg.url, token: agent.token, nodePath: process.execPath, env: process.env,
    approvals: approvalsOn ? {
      script: path.join(HERE, "approvals-mcp.mjs"),
      env: { APPROVAL_URL: approval.url, APPROVAL_SECRET: approval.secret, SLATES_TASK_ID: t.id },
    } : null,
    calls: callsOn ? {
      script: path.join(HERE, "calls-mcp.mjs"),
      env: { CALLS_URL: calls.url, GROUP_URL: calls.groupUrl, DECIDE_URL: calls.decideUrl, ...(geminiOn ? { GEMINI_URL: calls.geminiUrl } : {}), CALLS_SECRET: approval.secret, SLATES_TASK_ID: t.id },
    } : null,
    // Command agents (Codex etc.) bring their own tools; the browser is for Claude.
    browser: browserOn && agent.kind === "claude",
  });
  fs.writeFileSync(file, JSON.stringify(conf), { mode: 0o600 });
  return file;
}

function runAgent(agent, t) {
  const dir = path.join(cfg.workDir, safeName(agent.name), safeName(t.id));
  fs.mkdirSync(dir, { recursive: true });
  const mcpFile = writeMcpConfig(dir, agent, t);
  const logFile = path.join(dir, "run.log");
  const extraTools = extraAllowedTools(agent, {
    approvals: approvalsOn, calls: callsOn, gemini: geminiOn, browser: browserOn,
    // Incidents: the agent may read and revert code with gh/git (the playbook limits it to a revert after the owner's yes).
    incidentTools: parseIncidentMarker(t.context) ? (process.env.INCIDENT_TOOLS || "Bash(gh:*),Bash(git:*)").split(",").map((x) => x.trim()).filter(Boolean) : [],
  });
  const runAs = extraTools.length ? { ...agent, allowedTools: [...agent.allowedTools, ...extraTools] } : agent;
  const isClaude = agent.kind === "claude";
  const prompt = buildPrompt(t, { approvals: approvalsOn && isClaude, calls: callsOn && isClaude, gemini: callsOn && geminiOn && isClaude, browser: browserOn && isClaude, ownerName: cfg.ownerName });
  const { bin, args: cliArgs } = buildAgentCommand(runAs, { prompt, mcpFile, workdir: dir });

  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile);
    // Command agents can't take an MCP config file, so they also get the Slates details as env vars.
    const env = {
      ...process.env, SLATES_MCP_URL: cfg.url, SLATES_TOKEN: agent.token, SLATES_TASK_ID: t.id,
      // Let a tool call wait for the owner's tap (Claude Code's MCP tool timeout, in ms).
      // Covers waiting for the owner's tap plus, for calls, the call itself.
      ...(approvalsOn ? { MCP_TOOL_TIMEOUT: String((cfg.approvalTimeoutSec + Number(process.env.CALL_RING_SEC || 300) + cfg.callMaxMinutes * 60 + 120) * 1000) } : {}),
    };
    const child = spawn(bin, cliArgs, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d; out.write(d); });
    child.stderr.on("data", (d) => out.write(d));

    let timedOut = false;
    const timer = setTimeout(() => {
      log(`  ⏱  ${agent.name}/${t.id} hit ${cfg.timeoutMin} min timeout, stopping it`);
      timedOut = true;
      child.kill("SIGTERM");
    }, cfg.timeoutMin * 60_000);

    const finish = (code, summary) => {
      clearTimeout(timer);
      out.end();
      fs.rmSync(mcpFile, { force: true }); // don't leave the token on disk
      resolve({ code, summary, logFile, stdout, timedOut });
    };
    child.on("close", (code) => finish(code, summarizeClaudeOutput(stdout)));
    child.on("error", (err) => finish(-1, err.message));
  });
}

// ---------- main loop ----------

// Poll every agent's desk, then run all new tasks with at most MAX_CONCURRENT at once.
async function pollOnce() {
  const queue = [];
  for (const agent of agents) {
    let desk;
    try {
      desk = await withSlates(agent.token, (c) => callTool(c, "check_desk"));
    } catch (err) {
      log(`poll error (${agent.name}): ${err.message}`);
      continue;
    }
    const tasks = tasksFromDesk(desk, agent.name);
    const prev = state.agents[agent.name] ?? null;
    const plan = planPoll(prev, tasks, { includeExisting: INCLUDE_EXISTING, now: now() });
    state.agents[agent.name] = plan.state;
    if (prev === null) saveState(state);
    if (plan.baselined) {
      log(`${agent.name}: first run, ${plan.baselined} item(s) already on the desk were marked as seen, not run.`);
      log(`(Use --include-existing to run them.)`);
    }
    for (const t of plan.toRun) queue.push({ agent, t });
  }
  // Self-created tasks: run once, unless the desk already gave us the same id.
  while (localQueue.length) {
    const item = localQueue.shift();
    const seen = (state.agents[item.agent.name] ??= { seen: {} }).seen;
    if (seen[item.t.id] || queue.some((q) => q.t.id === item.t.id)) continue;
    queue.push(item);
  }

  // Tasks that have to wait for a free slot show up as queued.
  for (const { agent, t } of queue.slice(cfg.maxConcurrent)) {
    await workUpdate(agent, t.id, { agent: agent.name, task: t.task, status: STATUS.queued, update: "Waiting for a free slot" });
  }

  await mapLimit(queue, cfg.maxConcurrent, async ({ agent, t }) => {
    const seen = state.agents[agent.name].seen;
    log(`▶ ${agent.name} ← ${t.id} (${t.kind} from ${t.from}): ${oneLine(t.task)}`);
    if (DRY_RUN) {
      log(`  (dry run, not running)`);
      return;
    }
    // Mark before running so a crash never makes us run the same task twice.
    seen[t.id] = { status: "running", at: now() };
    saveState(state);
    const fromChat = parseTelegramMarker(t.context);
    if (fromChat) approval.taskChats.set(t.id, fromChat.chatId);
    await report(agent, activityMessage("start", t, { agentName: agent.name }));
    await workUpdate(agent, t.id, { agent: agent.name, task: t.task, status: STATUS.working, update: "Started", result: "" });

    const r = await runAgent(agent, t);
    seen[t.id] = { status: r.code === 0 ? "done" : "failed", exit: r.code, at: now(), log: r.logFile };
    saveState(state);
    const relLog = path.relative(HERE, r.logFile);
    await report(agent, activityMessage(r.code === 0 ? "done" : "failed", t, { agentName: agent.name, summary: r.summary, code: r.code, logFile: relLog }));
    log(`  ${r.code === 0 ? "✓" : "✗"} ${agent.name} ${t.id} exit=${r.code} ${r.summary}  log: ${relLog}`);
    if (r.code === 0) {
      await workUpdate(agent, t.id, { status: STATUS.done, update: "Finished", result: resultLine(extractResultText(r.stdout)) || "Done" });
    } else {
      await workUpdate(agent, t.id, {
        status: STATUS.failed,
        update: r.timedOut ? `Timed out after ${cfg.timeoutMin} min` : `Stopped with exit code ${r.code}`,
        result: r.summary || resultLine(extractResultText(r.stdout)) || "See run.log on the runner",
      });
    }

    // Task came from Telegram: send the agent's answer back to that chat.
    const marker = parseTelegramMarker(t.context);
    if (marker && tg) {
      const text = telegramReplyText(agent.name, r.code === 0, extractResultText(r.stdout));
      await tg.client.sendMessage(marker.chatId, text, marker.messageId).catch((err) => log(`  (telegram reply failed: ${err.message})`));
    }
  });
}

// ---------- Telegram ----------

// One round of Telegram: fetch new messages (waiting up to `timeout` s), turn allowed ones into Slates tasks.
async function telegramCycle(timeout) {
  state.telegram ??= { offset: 0 };
  const updates = await tg.client.getUpdates(state.telegram.offset, timeout);
  for (const u of updates) {
    state.telegram.offset = u.update_id + 1;
    saveState(state); // never handle the same message twice
    const route = routeTelegramUpdate(u, tg.allowed);
    if (route.action === "callback") {
      await handleApprovalTap(route);
    } else if (route.action === "reply") {
      await tg.client.sendMessage(route.chatId, route.text).catch((err) => log(`telegram send failed: ${err.message}`));
    } else if (route.action === "task") {
      log(`✉ Telegram ${route.chatId}: ${oneLine(route.text)} → ${tg.toAgent}`);
      try {
        const task = route.text.slice(0, 400);
        const context = `From Telegram ${telegramMarker(route.chatId, route.messageId)}. Full message: ${route.text}`.slice(0, 400);
        const created = await withSlates(tg.slatesToken, (c) => callTool(c, "hand_off", { task, to: tg.toAgent, context }));
        // Same identity on both ends → Slates won't show it on our desk, so run it from the local queue.
        const target = agents.find((a) => a.name.toLowerCase() === String(tg.toAgent).toLowerCase());
        if (target && target.token === tg.slatesToken) queueLocal(target, created, { from: "Telegram", task, context });
        await tg.client.sendMessage(route.chatId, `📥 Slates got it. ${tg.toAgent} is on it; I'll message you here when it's done.`, route.messageId);
        wake = true;
      } catch (err) {
        log(`telegram → Slates failed: ${err.message}`);
        await tg.client.sendMessage(route.chatId, `❌ Couldn't reach Slates: ${err.message}`, route.messageId).catch(() => {});
      }
    }
  }
}

// ---------- approvals ----------

// Local HTTP endpoint the approvals MCP server calls. Only reachable from this machine, needs the secret.
function startApprovalServer() {
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${approval.secret}`) return reply(401, { error: "unauthorized" });
    let body = "";
    for await (const c of req) body += c;
    let q;
    try {
      q = JSON.parse(body);
    } catch {
      return reply(400, { error: "bad json" });
    }
    try {
      if (req.url === "/approval") return reply(200, { answer: await askOwner(q) });
      if (req.url === "/call" && callsOn) return reply(200, await handleCall(q));
      if (req.url === "/group" && callsOn) return reply(200, await handleGroup(q));
      if (req.url === "/decide" && callsOn) return reply(200, await handleDecide(q));
      if (req.url === "/gemini" && geminiOn) return reply(200, await askGemini(q));
      reply(404, { error: "unknown endpoint" });
    } catch (err) {
      reply(200, { error: err.message });
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    approval.url = `${base}/approval`;
    calls.url = `${base}/call`;
    calls.groupUrl = `${base}/group`;
    calls.decideUrl = `${base}/decide`;
    calls.geminiUrl = `${base}/gemini`;
    resolve(server);
  }));
}

// ---------- calls ----------

const taskSlug = (taskId) => String(taskId).toLowerCase().replace(/[^a-z0-9]+/g, "-");

// Get a group of people to agree on one option, by phone. One owner approval covers the listed people.
async function handleGroup(input) {
  const g = validateGroup(input, { maxPeople: cfg.groupMaxPeople });
  if (!g.ok) return { error: g.reason };
  for (const p of g.people) {
    const check = checkCall({ phone: p.phone, callsSoFar: 0, maxCalls: 1, quietHours: cfg.callQuietHours, timeZone: cfg.callTimeZone, allowedPrefixes: cfg.callAllowedPrefixes });
    if (!check.ok) return { error: `${p.name}: ${check.reason}` };
  }
  const { taskId } = input;
  if (calls.perTask.get(`group:${taskId}`)) return { error: "this task already ran a group; one per task" };
  calls.perTask.set(`group:${taskId}`, 1);

  const answer = await askOwner({ question: groupApprovalQuestion(g), details: groupApprovalDetails(g), taskId });
  if (answer !== "yes") return { error: answer === "no" ? "the owner declined" : "the owner did not approve in time" };

  const agent = agentForTask(taskId);
  const slates = (fn) => withSlates(agent.token, fn).catch((err) => log(`  (Slates write failed: ${err.message})`));

  // 1. A live board everyone can follow.
  let slug = `group-${taskSlug(taskId)}`.slice(0, 60);
  let boardUrl = "";
  const created = await slates((c) => callTool(c, "create_slate", {
    title: g.title, kind: "table", slug, icon: "people", category: "Plans",
    data: boardData(g.people), note: `${agent.name} is coordinating ${g.people.length} people`,
  }));
  if (created?.slug) slug = created.slug;
  boardUrl = created?.url || "";
  const setRow = (p, status, ans) => slates((c) => callTool(c, "patch_items", { slug, upsert: [boardRow(p, status, ans)] }));

  // 2. Ask everyone; 3. retry anyone who didn't pick up, once.
  const goal = `${g.question} Options: ${g.options.join(", ")}.`;
  const results = {};
  const callOne = async (p, round) => {
    await setRow(p, round === 1 ? "calling…" : "calling again…", "");
    const r = await callProvider.call({ to: p.phone, name: p.name, goal, greeting: disclosureGreeting(cfg.ownerName, p.name), options: g.options, maxMinutes: cfg.callMaxMinutes, ...callExtras(taskId) });
    results[p.id] = { status: r.status, answer: r.choice || (r.status === "completed" ? "none of these" : ""), transcript: r.transcript };
    log(`👥 ${p.name}: ${r.status}${r.choice ? ` → ${r.choice}` : ""}`);
    await setRow(p, r.status === "completed" ? "answered" : r.status === "no_answer" ? "no answer" : "failed", results[p.id].answer);
  };
  // Real link-based calls ring everyone at once and wait once; scripted/phone calls go one by one with a retry round.
  const rounds = callProvider.parallel ? [1] : [1, 2];
  for (const round of rounds) {
    const todo = g.people.filter((p) => round === 1 || results[p.id]?.status === "no_answer");
    if (callProvider.parallel) await Promise.all(todo.map((p) => callOne(p, round)));
    else for (const p of todo) await callOne(p, round);
  }

  // 4. Decide; 5. confirm with everyone who answered.
  const result = tally(g.people.map((p) => (g.options.includes(results[p.id].answer) ? results[p.id].answer : null)), g.options);
  if (result.winner && input.confirm !== false && !callProvider.parallel) {
    for (const p of g.people.filter((x) => results[x.id].status === "completed")) {
      const r = await callProvider.call({ to: p.phone, name: p.name, goal: `Let them know the plan for "${g.title}" is: ${result.winner}. Thank them.`, greeting: disclosureGreeting(cfg.ownerName, p.name), maxMinutes: 2, ...callExtras(taskId) });
      results[p.id].confirmed = r.status === "completed";
      await setRow(p, results[p.id].confirmed ? "confirmed ✓" : "answered (confirm failed)", results[p.id].answer);
    }
  }

  // 6. Summary note.
  const note = groupSummaryNote({ ...g, results, result, boardUrl });
  await slates((c) => callTool(c, "add_note", { ...note, id: `group-${taskSlug(taskId)}`.slice(0, 64) }));

  return {
    winner: result.winner, tie: result.tie, counts: result.counts, boardUrl,
    people: g.people.map((p) => ({ name: p.name, status: results[p.id].status, answer: results[p.id].answer, confirmed: Boolean(results[p.id].confirmed) })),
  };
}

function agentForTask(taskId) {
  return agents.find((a) => state.agents[a.name]?.seen?.[taskId]) || agents[0];
}

// Extra arguments every provider call gets: a way to message the owner (call links) and their name.
function callExtras(taskId) {
  const chatId = approval.taskChats.get(taskId) || [...tg.allowed][0];
  return { ownerName: cfg.ownerName, notify: (text) => tg.client.sendMessage(chatId, text).catch((err) => log(`  (telegram notify failed: ${err.message})`)) };
}

// Public call page (Agora provider): people open their call link here. Bound to localhost; a tunnel makes it public.
function startCallPageServer() {
  if (!callProvider?.handlePage && !askHandler) return null;
  const port = Number(process.env.CALL_PAGE_PORT || 8787);
  const server = http.createServer(async (req, res) => {
    try {
      if (askHandler && (await askHandler.handle(req, res))) return;
      if (twilio && (await twilio.handleWebhook(req, res))) return;
      if (!(await callProvider?.handlePage?.(req, res))) res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end("error");
    }
  });
  server.listen(port, "127.0.0.1", () => log(`📞 call pages on http://127.0.0.1:${port} → public at ${process.env.PUBLIC_BASE_URL || "(set PUBLIC_BASE_URL)"}`));
  return server;
}

// The agent phones the owner for a decision. No approval needed (it's the owner themselves); falls back to
// Telegram buttons if they don't pick up. Returns { choice, via, transcript, noteUrl }.
// If Claude's tool call times out and it asks again, it joins the decision already in progress
// instead of ringing the owner a second time.
function handleDecide(input) {
  const key = input?.taskId || "";
  const running = calls.inflight.get(key);
  if (running) { log(`☎️  ${key}: a decision call is already in progress, waiting for it`); return running; }
  const p = decideOnce(input).finally(() => calls.inflight.delete(key));
  calls.inflight.set(key, p);
  return p;
}

async function decideOnce({ headline, briefing, question, options, team_says = [], taskId }) {
  if (!headline || !briefing || !question || !Array.isArray(options) || options.length < 2) return { error: "headline, briefing, question and 2+ options are required" };
  const n = (calls.perTask.get(`decide:${taskId}`) || 0) + 1;
  if (n > 2) return { error: "already asked the owner twice for this task" };
  calls.perTask.set(`decide:${taskId}`, n);
  const agent = agentForTask(taskId);
  log(`☎️  ${agent.name} calling ${cfg.ownerName} for a decision: ${oneLine(headline)}`);
  workUpdate(agent, taskId, { status: STATUS.needsYou, update: `Calling you: ${headline}` });
  const external = { choice: null, via: "" };
  let phone = null;
  const greetingText = `Hi ${cfg.ownerName}, it's Slates. Sorry to disturb. ${headline}.`;
  const r = await callProvider.call({
    external,
    name: cfg.ownerName, toOwner: true, options, maxMinutes: 4, ringSec: num(process.env.OWNER_RING_SEC, 120), ...callExtras(taskId),
    goal: `${briefing} Then ask: ${question}`,
    cast: (team_says || []).filter((t) => t.agent !== "Gemini" || geminiOn).map((t) => ({ name: t.agent, says: t.says, role: t.agent === "Gemini" ? "Second opinion" : "Investigated" })),
    room: { headline, question },
    greeting: team_says?.length
      ? `Hi ${cfg.ownerName}, it's Slates. Sorry to disturb. ${headline}. I have ${team_says.map((t) => t.agent).join(" and ")} on the line.`
      : `Hi ${cfg.ownerName}, it's Slates. Sorry to disturb. ${headline}. Your agents need a quick decision. Got a minute?`,
    notifyText: `🚨 ${headline}\nSlates, Claude${geminiOn ? " and Gemini" : ""} need you on a call. Tap to join:`,
    onLink: async (link) => {
      await ringViaSlates(agent, { headline, link, team: team_says });
      // Also ring their real phone when Twilio is set up; whichever they answer first wins.
      if (twilio) {
        phone = await twilio.ring({ greeting: greetingText, briefing, question, options, timeoutSec: num(process.env.OWNER_RING_SEC, 120) + 60 });
        phone.answer.then((c) => { if (c && !external.choice) { external.choice = c; external.via = "the phone call"; log(`📱 answered by phone: ${c}`); } });
      }
      ntfy?.({ title: `Slates is calling: ${headline}`, message: `${headline}. Claude${geminiOn ? " and Gemini" : ""} need a quick decision. Tap to join the call.`, priority: 5, tags: ["rotating_light"], click: link, actions: [{ label: "Join call", url: link }] });
    },
  });
  if (phone && !external.choice) await phone.cancel();
  await clearSlatesCall(agent);
  let choice = r.choice || external.choice || null;
  let via = external.choice ? "phone call" : `voice call (${r.status})`;
  if (!choice && r.status !== "completed") {
    const ans = await askOwner({ question: `${headline}: ${question}`, details: briefing, taskId });
    choice = ans === "yes" ? options[0] : ans === "no" ? options[1] : null;
    via = `Telegram buttons (${ans}) after the call was ${r.status}`;
  }
  log(`☎️  decision: ${choice || "none"} via ${via}`);
  workUpdate(agent, taskId, { status: STATUS.working, update: `Decision: ${choice || "none"} (${via})` });
  if (choice === options[0]) calls.saidYes.set(taskId, Date.now());
  let noteUrl = "";
  try {
    const note = callNote({ name: cfg.ownerName, phone: "owner", goal: `${headline}: ${question}`, result: { ...r, summary: `Decision: ${choice || "none"} (${via}). ${r.summary || ""}` }, taskId, agentName: agent.name });
    const saved = await withSlates(agent.token, (c) => callTool(c, "add_note", { ...note, id: `decision-${taskSlug(taskId)}-${n}`.slice(0, 64) }));
    noteUrl = saved?.url || "";
  } catch (err) {
    log(`  (could not save decision note: ${err.message})`);
  }
  return { choice, via, transcript: r.transcript, noteUrl };
}

// "Slates is calling": a push from the Slates app itself. Slates' notify opens a board, so the live
// call link sits on a small pinned links board; tapping the push opens it, then "Join call".
const CALL_BOARD = "slates-call";
async function ringViaSlates(agent, { headline, link, team = [] }) {
  const who = team?.length ? `${team.map((t) => t.agent).join(" and ")} ${team.length > 1 ? "are" : "is"} on the line.` : "Your agents need a quick decision.";
  const item = { id: "now", title: `Join the call: ${headline}`.slice(0, 200), url: link, detail: who };
  await withSlates(agent.token, async (c) => {
    try {
      await callTool(c, "patch_items", { slug: CALL_BOARD, upsert: [item] });
    } catch {
      await callTool(c, "create_slate", { title: "Slates is calling", kind: "links", slug: CALL_BOARD, icon: "phone", category: "Work", pinned: true, data: { items: [item] }, note: "Live call link" });
    }
    await callTool(c, "notify", { title: "Slates is calling", body: `${headline}. ${who} Tap to join.`.slice(0, 300), slug: CALL_BOARD });
  }).catch((err) => log(`  (Slates push failed: ${err.message})`));
}

async function clearSlatesCall(agent) {
  await withSlates(agent.token, (c) => callTool(c, "patch_items", { slug: CALL_BOARD, upsert: [{ id: "now", title: "No call right now", url: "https://www.slates.space/home", detail: "Slates puts the join link here when it calls you." }] }))
    .catch(() => {});
}

// Independent second opinion from Gemini (REST, API key). Model is configurable; the default may need updating.
async function askGemini({ question, evidence }) {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are a senior engineer giving an independent second opinion during an outage. Judge only from the evidence. Say clearly whether you agree with the proposed cause and fix, in under 120 words." }] },
      contents: [{ role: "user", parts: [{ text: `${question}\n\nEvidence:\n${String(evidence || "").slice(0, 20000)}` }] }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { error: `Gemini ${res.status}: ${j.error?.message || "request failed"}` };
  const answer = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  log(`♊ Gemini (${model}): ${oneLine(answer)}`);
  return { model, answer: answer || "(no answer)" };
}

// ---------- watchers ----------

// Check each watched site; when one goes down: alert the owner, open an incident board, hand the incident to an agent.
async function watchOnce(watchers) {
  state.watchers ??= {};
  for (const w of watchers) {
    let ok = false, status = 0, error = "";
    try {
      const res = await fetch(w.url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "cache-control": "no-cache" } });
      status = res.status;
      ok = res.status < 400;
      if (ok && w.expect) {
        const body = await res.text();
        if (!body.includes(w.expect)) { ok = false; error = `HTTP ${status} but the page no longer says "${w.expect}"`; }
      }
    } catch (err) {
      error = err.name === "TimeoutError" ? "timed out after 10s" : err.message;
    }
    const prev = state.watchers[w.name] || {};
    const { state: next, event } = stepWatcher(prev.check, { ok, status, error, at: now() }, { failsToAlert: num(process.env.WATCH_FAILS, 2) });
    state.watchers[w.name] = { ...prev, check: next };
    if (event?.type === "down") await onDown(w, event);
    if (event?.type === "up") await onUp(w, event);
    saveState(state);
  }
}

async function onDown(w, ev) {
  const agent = agents.find((a) => a.name === (process.env.WATCH_TO_AGENT || agents[0].name)) || agents[0];
  const slug = incidentSlug(w.name, ev.downSince);
  log(`🚨 ${w.name} is DOWN (${ev.detail}) → incident ${slug}, handing to ${agent.name}`);
  state.watchers[w.name].incident = { slug, at: ev.downSince, rows: 1 };
  const slates = (fn) => withSlates(agent.token, fn).catch((err) => log(`  (Slates write failed: ${err.message})`));
  await slates((c) => callTool(c, "create_slate", {
    title: `Incident: ${w.name} down`, kind: "table", slug, icon: "bell", category: "Work", pinned: true,
    data: { columns: INCIDENT_COLUMNS, rows: [incidentRow("r1", ev.downSince, "Watcher", `${w.url} is down: ${ev.detail}`)] },
    note: `Watcher: ${w.name} is down`,
  }));
  const { task, context } = incidentTask(w, ev, { slug, ownerName: cfg.ownerName });
  const created = await slates((c) => callTool(c, "hand_off", { task, to: agent.name, context }));
  queueLocal(agent, created, { from: "Watcher", task, context });
  ntfy?.({ title: `${w.name} is down`, message: `${w.url} is down (${ev.detail}). ${agent.name} is investigating; Slates will call you if they need you.`, priority: 4, tags: ["warning"] });
  if (tg) await tg.client.sendMessage([...tg.allowed][0], `🚨 Slates: ${w.name} is down (${ev.detail}).\n${agent.name}${geminiOn ? " and Gemini are" : " is"} investigating. Slates will call you if they need you.`).catch(() => {});
  wake = true;
}

async function onUp(w, ev) {
  const inc = state.watchers[w.name].incident;
  const mins = minutesBetween(ev.downSince, ev.at);
  log(`✅ ${w.name} is back UP after ${mins} min`);
  if (inc) {
    const agent = agents[0];
    await withSlates(agent.token, async (c) => {
      await callTool(c, "patch_items", { slug: inc.slug, upsert: [incidentRow(`up-${Date.now()}`, ev.at, "Watcher", `Back up (${ev.detail}). Down for ${mins} min.`)] });
      await callTool(c, "log_activity", { message: `${w.name} recovered after ${mins} min`, slug: inc.slug });
    }).catch((err) => log(`  (Slates write failed: ${err.message})`));
    state.watchers[w.name].incident = null;
  }
  ntfy?.({ title: `${w.name} is back up`, message: `Down for ${mins} min. Details on the Slates incident board.`, priority: 3, tags: ["white_check_mark"] });
  if (tg) await tg.client.sendMessage([...tg.allowed][0], `✅ Slates: ${w.name} is back up. Down for ${mins} min.`).catch(() => {});
}

async function watchLoop(watchers, isStopping) {
  const every = num(process.env.WATCH_SECONDS, 30) * 1000;
  log(`👀 watching ${watchers.map((w) => `${w.name}${w.repo ? ` (${w.repo})` : ""}`).join(", ")} every ${every / 1000}s`);
  while (!isStopping()) {
    await watchOnce(watchers).catch((err) => log(`watch error: ${err.message}`));
    await sleep(every, isStopping);
  }
}

// One call: rules → owner's Yes → provider → transcript saved to Slates.
async function handleCall({ phone, name, goal, notes, taskId }) {
  if (!goal) return { error: "goal is required" };
  const made = calls.perTask.get(taskId) || 0;
  const check = checkCall({
    phone, callsSoFar: made, maxCalls: cfg.callMaxPerTask,
    quietHours: cfg.callQuietHours, timeZone: cfg.callTimeZone, allowedPrefixes: cfg.callAllowedPrefixes,
  });
  if (!check.ok) return { error: check.reason };
  calls.perTask.set(taskId, made + 1); // counts asks too, so an agent can't spam the owner

  const answer = await askOwner({ question: callApprovalQuestion({ name, phone: check.phone, goal }), details: notes, taskId });
  if (answer !== "yes") return { error: answer === "no" ? "the owner declined this call" : "the owner did not approve in time" };

  const agent = agentForTask(taskId);
  const greeting = disclosureGreeting(cfg.ownerName, name);
  log(`📞 ${agent.name} calling ${name || ""} ${check.phone} (${callProvider.name}): ${oneLine(goal)}`);
  const result = await callProvider.call({ to: check.phone, name, goal, notes, greeting, maxMinutes: cfg.callMaxMinutes, ...callExtras(taskId) });
  log(`📞 call ${result.status}: ${oneLine(result.summary)}`);

  let noteUrl = "";
  try {
    const note = callNote({ name, phone: check.phone, goal, result, taskId, agentName: agent.name });
    const id = `call-${String(taskId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${made + 1}`.slice(0, 64);
    const saved = await withSlates(agent.token, (c) => callTool(c, "add_note", { ...note, id }));
    noteUrl = saved?.url || "";
  } catch (err) {
    log(`  (could not save call note: ${err.message})`);
  }
  return { ...result, noteUrl };
}

// Send Yes/No buttons to the owner and wait for a tap (or time out → "timeout").
async function askOwner({ question, details, taskId }) {
  // The owner already said yes on a call for this task in the last 10 minutes: don't ask twice.
  const yesAt = calls.saidYes.get(taskId);
  if (yesAt && Date.now() - yesAt < 10 * 60_000) {
    calls.saidYes.delete(taskId);
    log(`🔐 approval auto-yes (${taskId}): owner already said go ahead on the call`);
    return "yes";
  }
  const chatId = approval.taskChats.get(taskId) || [...tg.allowed][0];
  const agentName = agents.find((a) => state.agents[a.name]?.seen?.[taskId])?.name || "Your agent";
  const id = crypto.randomBytes(6).toString("hex");
  const prompt = approvalPromptText(agentName, String(question || "").slice(0, 300), details ? String(details).slice(0, 700) : "");
  const sent = await tg.client.sendMessage(chatId, prompt, undefined, approvalKeyboard(id));
  log(`🔐 approval asked (${taskId}): ${oneLine(question)}`);
  const askedFor = state.agents && agents.find((a) => state.agents[a.name]?.seen?.[taskId]);
  const q = short(question, 100);
  if (askedFor) workUpdate(askedFor, taskId, { status: STATUS.needsYou, update: `Waiting for your tap: ${q}` });
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle("timeout"), cfg.approvalTimeoutSec * 1000);
    function settle(answer) {
      clearTimeout(timer);
      approval.pending.delete(id);
      tg.client.editMessageText(chatId, sent.message_id, approvalResultText(prompt, answer)).catch(() => {});
      log(`🔐 approval ${answer} (${taskId})`);
      if (askedFor) workUpdate(askedFor, taskId, { status: STATUS.working, update: `${answer === "yes" ? "You approved" : answer === "no" ? "You declined" : "No answer in time"}: ${q}` });
      resolve(answer);
    }
    approval.pending.set(id, { chatId, settle });
  });
}

async function handleApprovalTap(route) {
  const tap = parseApprovalData(route.data);
  const pending = tap && approval.pending.get(tap.id);
  if (!pending || pending.chatId !== route.chatId) {
    await tg.client.answerCallbackQuery(route.callbackId, "This request has already been handled.").catch(() => {});
    return;
  }
  await tg.client.answerCallbackQuery(route.callbackId, tap.answer === "yes" ? "Approved" : "Declined").catch(() => {});
  pending.settle(tap.answer);
}

async function telegramLoop(isStopping, timeout = 25) {
  if (timeout > 5) log(`Telegram front door on: ${tg.allowed.size} allowed chat(s), tasks go to ${tg.toAgent}${approvalsOn ? ", approvals on" : ""}`);
  while (!isStopping()) {
    try {
      await telegramCycle(timeout);
    } catch (err) {
      log(`telegram error: ${err.message}`);
      await sleep(5000, isStopping);
    }
  }
}

async function main() {
  fs.mkdirSync(cfg.workDir, { recursive: true });
  const who = agents.map((a) => `${a.name} (${a.kind})`).join(", ");
  log(`Slates runner → ${cfg.url}  agents: ${who}  every ${cfg.pollSeconds}s, max ${cfg.maxConcurrent} at once`);
  state = loadState();
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; log("Stopping after the current step…"); });
  process.on("SIGTERM", () => { stopping = true; });

  if (approvalsOn && !DRY_RUN) await startApprovalServer();
  if (process.env.ASK_SECRET && !DRY_RUN) {
    const available = detectAskAgents(process.env);
    const slatesToken = process.env.SLATES_TOKEN || agents[0].token;
    askHandler = createAskHandler({
      secret: process.env.ASK_SECRET, available, ownerName: cfg.ownerName,
      runAgent: createAgentRunner(process.env, { slatesUrl: cfg.url, token: slatesToken, log }),
      speak: agoraSpeaker(process.env, { log }),
      interrupt: agoraInterrupter(process.env, { log }),
      // Jump-ins: a cheap Gemini call decides if another agent should chime in. ROOM_JUMP_IN=false turns it off.
      moderate: process.env.ROOM_JUMP_IN === "false" ? null : geminiModerator(process.env, { log }),
      moderatorTimeoutMs: num(process.env.MODERATOR_TIMEOUT_MS, 3000),
      jumpAfterHost: process.env.ROOM_JUMP_AFTER_HOST !== "false",
      log,
    });
    log(`🎙  live agents (POST /ask, /room/*): ${available.join(", ")}${process.env.GEMINI_API_KEY && process.env.ROOM_JUMP_IN !== "false" ? "; jump-ins on" : ""}`);
  }
  if (callsOn && !DRY_RUN) {
    if (callProvider.missing?.length) log(`📞 calls: ${callProvider.name} is missing ${callProvider.missing.join(", ")}; calls will fail until set`);
    else log(`📞 calls on (${callProvider.name})`);
  }
  if ((callsOn || askHandler) && !DRY_RUN) startCallPageServer();

  if (ONCE || DRY_RUN) {
    // One pass: Telegram first (no waiting), so a new message is run in the same pass.
    if (tg && !DRY_RUN) await telegramCycle(0).catch((err) => log(`telegram error: ${err.message}`));
    const onceWatchers = parseWatchers(process.env.WATCH_URLS, process.env.WATCH_REPOS, process.env.WATCH_EXPECT);
    if (onceWatchers.length && !DRY_RUN) await watchOnce(onceWatchers).catch((err) => log(`watch error: ${err.message}`));
    // Keep listening to Telegram while tasks run, so approval taps arrive.
    let passDone = false;
    const tgDuring = tg && !DRY_RUN ? telegramLoop(() => passDone, 2) : Promise.resolve();
    await pollOnce().catch((err) => log(`poll error: ${err.message}`));
    passDone = true;
    await tgDuring;
    process.exit(0); // the approval server would otherwise keep the process alive
  }

  const tgDone = tg ? telegramLoop(() => stopping) : Promise.resolve();
  const watchers = parseWatchers(process.env.WATCH_URLS, process.env.WATCH_REPOS, process.env.WATCH_EXPECT);
  const watchDone = watchers.length ? watchLoop(watchers, () => stopping) : Promise.resolve();
  while (!stopping) {
    wake = false;
    try {
      await pollOnce();
    } catch (err) {
      log(`poll error: ${err.message}`);
    }
    await sleep(cfg.pollSeconds * 1000, () => stopping || wake);
  }
  await tgDone;
  await watchDone;
  process.exit(0);
}

// ---------- helpers ----------

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; }
function now() { return new Date().toISOString(); }
function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }
async function sleep(ms, shouldStop) {
  const end = Date.now() + ms;
  while (Date.now() < end && !shouldStop()) await new Promise((r) => setTimeout(r, 500));
}

main().catch((err) => { console.error(err); process.exit(1); });
