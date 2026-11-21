import { parseIncidentMarker, incidentPlaybook } from "./watchers.mjs";
// Pure logic for the Slates runner (no network, no processes), so it can be unit tested.

// Turn check_desk output into runnable tasks for one agent.
export function tasksFromDesk(desk, agentName) {
  const me = String(agentName || "").toLowerCase();
  const tasks = [];
  for (const h of desk?.handoffs || []) {
    if (h.to && h.to.toLowerCase() !== me) continue;
    tasks.push({ id: h.id, kind: "handoff", from: h.from, task: h.task, context: h.context });
  }
  // check_desk already filters instructions to this agent (or untagged ones).
  for (const i of desk?.instructions || []) {
    tasks.push({
      id: i.id,
      kind: "instruction",
      from: i.from || "user",
      task: i.text || i.task || JSON.stringify(i),
      context: i.context,
    });
  }
  return tasks.filter((t) => t.id && t.task);
}

// Decide what to run this poll. Returns { state, toRun, baselined }.
// First run (state === null) marks everything already waiting as seen, unless includeExisting.
export function planPoll(state, tasks, { includeExisting = false, now = new Date().toISOString() } = {}) {
  if (state === null) {
    const fresh = { seen: {} };
    if (!includeExisting) {
      for (const t of tasks) fresh.seen[t.id] = { status: "skipped-at-start", at: now };
      return { state: fresh, toRun: [], baselined: tasks.length };
    }
    state = fresh;
  }
  const toRun = tasks.filter((t) => !state.seen[t.id]);
  return { state, toRun, baselined: 0 };
}

export function buildPrompt(t, { approvals = false, calls = false, gemini = false, browser = false, ownerName = "the owner" } = {}) {
  return [
    `You are running unattended on the Slates runner. Nobody is watching this session live.`,
    ``,
    `Desk item ${t.id} (${t.kind} from ${t.from || "unknown"}):`,
    t.task,
    t.context ? `\nContext: ${t.context}` : ``,
    ``,
    `How to work:`,
    `- Use the Slates tools to read what you need (get_about_me, search, get_note, get_slate).`,
    `- Do the task with the tools you have. Never guess past a blocker.`,
    `- If you need a decision, an approval, money, or access you do not have, call ask_user with a clear question and stop.`,
    `- When finished (or blocked), call resolve_desk_item with id "${t.id}" and a short reply saying what you did or what blocked you.`,
    `- Then call end_session with what you did and what is still open.`,
    ...(approvals
      ? [``, `Before anything risky or hard to undo (contacting people, spending money, booking, deleting, deploying), call request_approval with one clear yes/no question and continue only if it says APPROVED. It asks the owner on their phone.`]
      : []),
    ...(browser
      ? [``, `You have a real web browser (the playwright tools: browser_navigate, browser_snapshot, browser_click, browser_type, browser_fill_form and others). Use it to open websites, read pages and fill in forms when the task needs the web. Before you submit anything that spends money, books, signs up for something, or sends a message, call request_approval with exactly what you are about to do, and submit only if it says APPROVED.${approvals ? "" : " request_approval is not available on this runner, so stop before submitting and say what is ready instead."}`]
      : []),
    ...(calls
      ? [`You can phone people with call_person when the task truly needs a conversation, and use coordinate_group to get several people to agree on one option (it calls everyone, keeps a live board, picks the most-chosen option and confirms it). The owner approves first, and every call opens by saying it's an AI calling for them.`]
      : []),
    ...(parseIncidentMarker(t.context)
      ? [``, incidentPlaybook(parseIncidentMarker(t.context), { ownerName, gemini, calls })]
      : []),
    ...(parseTelegramMarker(t.context)
      ? [``, `This task came from the user's Telegram. Your final message is sent to them as a chat reply, so end with a short, plain answer (a few lines, no tables).`]
      : []),
  ].join("\n");
}

// Parse a tool result from the MCP SDK into a JS value.
export function parseToolResult(res) {
  if (res?.structuredContent) return res.structuredContent;
  const text = (res?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// Summarise `claude -p --output-format json` stdout.
export function summarizeClaudeOutput(stdout) {
  try {
    const j = JSON.parse(stdout);
    return `${j.subtype || ""} cost=$${Number(j.total_cost_usd ?? 0).toFixed(3)} turns=${j.num_turns ?? "?"}`.trim();
  } catch {
    return "";
  }
}

// Activity-feed message the runner posts to Slates (log_activity, max 500 chars).
export function activityMessage(event, t, { agentName = "Claude", summary = "", code, logFile = "" } = {}) {
  let msg;
  if (event === "start") msg = `Runner started ${agentName} on ${t.id}: ${oneLine(t.task)}`;
  else if (event === "done") msg = `Runner: ${agentName} finished ${t.id}${summary ? ` (${summary})` : ""}`;
  else msg = `Runner: ${agentName} FAILED on ${t.id} (exit ${code})${summary ? ` ${summary}` : ""}. Log on the runner: ${logFile}`;
  return msg.length > 500 ? msg.slice(0, 497) + "…" : msg;
}

// ---------- agents ----------
//
// One Slates token = one agent identity (check_desk only shows that agent's tasks).
// Single agent: SLATES_TOKEN + AGENT_NAME (+ AGENT_KIND). Several agents: AGENTS_FILE, a JSON list:
//   [{ "name": "Claude", "kind": "claude", "token_env": "SLATES_TOKEN_CLAUDE" },
//    { "name": "Codex",  "kind": "command", "token_env": "SLATES_TOKEN_CODEX",
//      "command": ["codex", "exec", "{prompt}"] }]
// Tokens are always read from environment variables, never from the JSON file.

const SPLIT = (s) => String(s || "").split(/\s+/).filter(Boolean);

export function loadAgents(env, agentsFileJson = null) {
  const defaults = {
    kind: "claude",
    allowedTools: SPLIT(env.ALLOWED_TOOLS || "mcp__slates__*"),
    maxBudgetUsd: String(env.MAX_BUDGET_USD || "2"),
    model: env.CLAUDE_MODEL || "",
    bin: env.CLAUDE_BIN || "claude",
  };
  let list;
  if (agentsFileJson) {
    const raw = typeof agentsFileJson === "string" ? JSON.parse(agentsFileJson) : agentsFileJson;
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("AGENTS_FILE must be a non-empty JSON list");
    list = raw.map((a) => {
      if (!a.name) throw new Error("every agent needs a name");
      if (!a.token_env) throw new Error(`agent ${a.name}: set token_env (the env var holding its Slates token)`);
      const token = env[a.token_env];
      if (!token) throw new Error(`agent ${a.name}: env var ${a.token_env} is not set`);
      return {
        ...defaults,
        name: a.name,
        kind: a.kind || "claude",
        token,
        command: a.command,
        allowedTools: a.allowed_tools ? SPLIT(a.allowed_tools) : defaults.allowedTools,
        maxBudgetUsd: a.max_budget_usd != null ? String(a.max_budget_usd) : defaults.maxBudgetUsd,
        model: a.model ?? defaults.model,
        bin: a.bin || defaults.bin,
      };
    });
  } else {
    if (!env.SLATES_TOKEN) throw new Error("SLATES_TOKEN is not set. Create an agent token in Slates and put it in .env (see .env.example).");
    list = [{ ...defaults, name: env.AGENT_NAME || "Claude", kind: env.AGENT_KIND || "claude", token: env.SLATES_TOKEN }];
  }
  for (const a of list) {
    if (!["claude", "command"].includes(a.kind)) throw new Error(`agent ${a.name}: unknown kind "${a.kind}" (use claude or command)`);
    if (a.kind === "command" && (!Array.isArray(a.command) || a.command.length === 0)) {
      throw new Error(`agent ${a.name}: kind "command" needs a "command" list, e.g. ["codex", "exec", "{prompt}"]`);
    }
  }
  const names = list.map((a) => a.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("agent names must be unique");
  return list;
}

// The process to start for one task. Returns { bin, args }.
// "command" agents get placeholders filled: {prompt}, {mcp_config}, {workdir}.
export function buildAgentCommand(agent, { prompt, mcpFile, workdir }) {
  if (agent.kind === "claude") {
    const args = [
      "-p", prompt,
      "--mcp-config", mcpFile,
      "--strict-mcp-config",
      "--allowedTools", ...agent.allowedTools,
      "--max-budget-usd", agent.maxBudgetUsd,
      "--output-format", "json",
    ];
    if (agent.model) args.push("--model", agent.model);
    return { bin: agent.bin, args };
  }
  const fill = (s) => String(s).replaceAll("{prompt}", prompt).replaceAll("{mcp_config}", mcpFile).replaceAll("{workdir}", workdir);
  const [bin, ...args] = agent.command.map(fill);
  return { bin, args };
}

// State file shape: { agents: { <name>: { seen: {...} } } }.
// Older single-agent files ({ seen }) are moved under the default agent's name.
export function migrateState(state, defaultAgent) {
  if (!state) return { agents: {} };
  if (state.agents) return state;
  if (state.seen) return { agents: { [defaultAgent]: { seen: state.seen } } };
  return { agents: {} };
}

// Run async fn over items with at most `limit` running at once. Keeps result order.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- Telegram front door ----------
// A task created from Telegram carries a marker in its context so the runner knows where to reply.

export function telegramMarker(chatId, messageId) {
  return `[telegram:${chatId}:${messageId}]`;
}

export function parseTelegramMarker(text) {
  const m = String(text || "").match(/\[telegram:(-?\d+):(\d+)\]/);
  return m ? { chatId: m[1], messageId: Number(m[2]) } : null;
}

export function parseAllowedChats(s) {
  return new Set(String(s || "").split(/[\s,]+/).filter(Boolean));
}

// What to do with one Telegram update. Returns one of:
//   { action: "ignore" } | { action: "reply", chatId, text } | { action: "task", chatId, messageId, text }
//   { action: "callback", callbackId, chatId, messageId, data }   (a button tap)
export function routeTelegramUpdate(update, allowed) {
  const cq = update?.callback_query;
  if (cq) {
    const chatId = String(cq.message?.chat?.id ?? "");
    if (!allowed.has(chatId)) return { action: "ignore" };
    return { action: "callback", callbackId: cq.id, chatId, messageId: cq.message.message_id, data: String(cq.data || "") };
  }
  const msg = update?.message;
  if (!msg?.chat) return { action: "ignore" };
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();
  if (!allowed.has(chatId)) {
    return { action: "reply", chatId, text: `This bot is private. Your chat id is ${chatId}. Ask the owner to add it to TELEGRAM_ALLOWED_CHAT_IDS.` };
  }
  if (!text) return { action: "reply", chatId, text: "Send me the task as a text message." };
  if (text === "/start" || text === "/help") {
    return { action: "reply", chatId, text: "Send me any task in plain words. I hand it to your agents on Slates and message you back when it's done." };
  }
  return { action: "task", chatId, messageId: msg.message_id, text };
}

// The final answer an agent gave, for sending back to the user.
// Claude Code (`--output-format json`) puts it in `result`; other agents: last part of stdout.
export function extractResultText(stdout) {
  try {
    const j = JSON.parse(stdout);
    if (typeof j.result === "string" && j.result.trim()) return j.result.trim();
  } catch {}
  const s = String(stdout || "").trim();
  return s.length > 1500 ? "…" + s.slice(-1500) : s;
}

// ---------- approvals ----------

export function approvalKeyboard(id) {
  return { inline_keyboard: [[{ text: "✅ Yes", callback_data: `ap:${id}:yes` }, { text: "❌ No", callback_data: `ap:${id}:no` }]] };
}

export function parseApprovalData(data) {
  const m = String(data || "").match(/^ap:([a-z0-9]+):(yes|no)$/);
  return m ? { id: m[1], answer: m[2] } : null;
}

export function approvalPromptText(agentName, question, details) {
  const msg = `🔐 Slates · ${agentName} needs your OK:\n\n${question}${details ? `\n\n${details}` : ""}`;
  return msg.length > 4000 ? msg.slice(0, 3997) + "…" : msg;
}

export function approvalResultText(prompt, answer) {
  const tail = answer === "yes" ? "✅ Approved" : answer === "no" ? "❌ Declined" : "⌛ No answer in time (treated as No)";
  return `${prompt}\n\n${tail}`.slice(0, 4000);
}

export function telegramReplyText(agentName, ok, resultText) {
  const head = ok ? `✅ Slates · ${agentName} finished.` : `⚠️ Slates · ${agentName} couldn't finish this one.`;
  const body = resultText ? `\n\n${resultText}` : "";
  const msg = head + body;
  return msg.length > 4000 ? msg.slice(0, 3997) + "…" : msg; // Telegram's limit is 4096
}

export function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function oneLine(s = "") {
  s = String(s).replace(/\s+/g, " ");
  return s.length > 100 ? s.slice(0, 97) + "…" : s;
}

// ---------- MCP config + allowed tools for one run ----------

// Microsoft's Playwright MCP server, pinned so a new release never changes behaviour under you.
export const PLAYWRIGHT_TOOLS = [
  "browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_take_screenshot", "browser_click", "browser_type",
  "browser_fill_form", "browser_select_option", "browser_press_key", "browser_hover", "browser_wait_for", "browser_tabs",
  "browser_find", "browser_handle_dialog", "browser_resize", "browser_close", "browser_console_messages", "browser_network_requests",
];
export const PLAYWRIGHT_MCP_VERSION = "0.0.86";

export function browserToolsOn(env) {
  return ["1", "true", "yes", "on"].includes(String(env?.BROWSER_TOOLS || "").toLowerCase());
}

// Headless, in-memory profile (no cookies or logins kept between tasks). BROWSER_NAME picks the browser
// (default: Playwright's "chrome" channel; use "chromium" on Linux ARM64, where Google Chrome isn't available).
export function playwrightServer(env = {}) {
  const args = ["-y", `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, "--headless", "--isolated"];
  if (env.BROWSER_NAME) args.push("--browser", String(env.BROWSER_NAME));
  return { type: "stdio", command: "npx", args };
}

// The MCP config file Claude gets for one task.
// approvals / calls: null when off, else { script, env } for the local stdio server.
export function buildMcpConfig({ slatesUrl, token, nodePath = "node", approvals = null, calls = null, browser = false, env = {} }) {
  const mcpServers = { slates: { type: "http", url: slatesUrl, headers: { Authorization: `Bearer ${token}` } } };
  if (approvals) mcpServers.approvals = { type: "stdio", command: nodePath, args: [approvals.script], env: approvals.env };
  if (calls) mcpServers.calls = { type: "stdio", command: nodePath, args: [calls.script], env: calls.env };
  if (browser) mcpServers.playwright = playwrightServer(env);
  return { mcpServers };
}

// Tools a claude-kind agent may use without asking, on top of its own allowed list.
export function extraAllowedTools(agent, { approvals = false, calls = false, gemini = false, browser = false, incidentTools = [] } = {}) {
  if (agent.kind !== "claude") return [];
  return [
    // request_approval only asks; it can't act. call_person is safe too: the runner asks the owner before every call.
    ...(approvals ? ["mcp__approvals__request_approval"] : []),
    ...(calls ? ["mcp__calls__call_person", "mcp__calls__coordinate_group", "mcp__calls__ask_owner_by_call"] : []),
    ...(calls && gemini ? ["mcp__calls__ask_gemini"] : []),
    // Named, not a wildcard: browser_evaluate and browser_run_code_unsafe (arbitrary JS) stay off.
    ...(browser ? PLAYWRIGHT_TOOLS.map((t) => `mcp__playwright__${t}`) : []),
    ...incidentTools,
  ];
}
