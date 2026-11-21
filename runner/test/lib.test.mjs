import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksFromDesk, planPoll, buildPrompt, parseToolResult, summarizeClaudeOutput, activityMessage, safeName } from "../lib.mjs";

// Shape taken from a real check_desk response (2026-11-21).
const desk = {
  instructions: [{ id: "i-1", text: "Add a note called Runner test" }],
  handoffs: [
    { id: "h-claude", from: "ChatGPT", to: "Claude", task: "Build the fitness PWA", context: "spec link" },
    { id: "h-gemini", from: "Claude", to: "Gemini", task: "Research X" },
    { id: "h-anyone", from: "Instinct", task: "Anyone can do this" },
  ],
  answers: [{ id: "ap-1", type: "approval", text: "Archive board", answer: "approved" }],
  waiting_on_user: [],
  last_sessions: [],
};

test("tasksFromDesk keeps only tasks for this agent", () => {
  const ids = tasksFromDesk(desk, "Claude").map((t) => t.id);
  assert.deepEqual(ids, ["h-claude", "h-anyone", "i-1"]);
});

test("tasksFromDesk matches agent name case-insensitively", () => {
  assert.ok(tasksFromDesk(desk, "claude").some((t) => t.id === "h-claude"));
});

test("tasksFromDesk ignores answers and handles empty desks", () => {
  assert.deepEqual(tasksFromDesk({}, "Claude"), []);
  assert.deepEqual(tasksFromDesk(null, "Claude"), []);
  assert.ok(!tasksFromDesk(desk, "Claude").some((t) => t.id === "ap-1"));
});

test("first poll baselines existing tasks instead of running them", () => {
  const tasks = tasksFromDesk(desk, "Claude");
  const { state, toRun, baselined } = planPoll(null, tasks, { now: "T" });
  assert.equal(toRun.length, 0);
  assert.equal(baselined, 3);
  assert.equal(state.seen["h-claude"].status, "skipped-at-start");
});

test("first poll with includeExisting runs everything", () => {
  const tasks = tasksFromDesk(desk, "Claude");
  const { toRun, baselined } = planPoll(null, tasks, { includeExisting: true });
  assert.equal(toRun.length, 3);
  assert.equal(baselined, 0);
});

test("later polls run only new tasks", () => {
  const tasks = tasksFromDesk(desk, "Claude");
  const first = planPoll(null, tasks, { now: "T" }).state;
  const newTask = { id: "h-new", kind: "handoff", from: "ChatGPT", task: "New thing" };
  const { toRun } = planPoll(first, [...tasks, newTask]);
  assert.deepEqual(toRun.map((t) => t.id), ["h-new"]);
});

test("buildPrompt includes task, context and the exact id to resolve", () => {
  const p = buildPrompt({ id: "h-claude", kind: "handoff", from: "ChatGPT", task: "Do X", context: "ctx" });
  assert.match(p, /Do X/);
  assert.match(p, /Context: ctx/);
  assert.match(p, /resolve_desk_item with id "h-claude"/);
});

test("parseToolResult handles JSON text, plain text and structured content", () => {
  assert.deepEqual(parseToolResult({ content: [{ type: "text", text: '{"a":1}' }] }), { a: 1 });
  assert.deepEqual(parseToolResult({ content: [{ type: "text", text: "hello" }] }), { text: "hello" });
  assert.deepEqual(parseToolResult({ structuredContent: { b: 2 } }), { b: 2 });
});

test("summarizeClaudeOutput reads claude -p json output", () => {
  const s = summarizeClaudeOutput(JSON.stringify({ subtype: "success", total_cost_usd: 0.1234, num_turns: 5 }));
  assert.equal(s, "success cost=$0.123 turns=5");
  assert.equal(summarizeClaudeOutput("not json"), "");
});

test("activityMessage covers start, done, failed and stays under 500 chars", () => {
  const t = { id: "h-1", task: "Do the thing" };
  assert.equal(activityMessage("start", t, { agentName: "Claude" }), "Runner started Claude on h-1: Do the thing");
  assert.equal(activityMessage("done", t, { agentName: "Claude", summary: "success" }), "Runner: Claude finished h-1 (success)");
  assert.match(activityMessage("failed", t, { code: 1, logFile: "work/h-1/run.log" }), /FAILED on h-1 \(exit 1\)\. Log on the runner: work\/h-1\/run\.log/);
  assert.ok(activityMessage("failed", t, { summary: "x".repeat(1000) }).length <= 500);
});

test("safeName makes ids safe for folder names", () => {
  assert.equal(safeName("h-mwn/../x"), "h-mwn____x");
});

// ---------- agents ----------
import { loadAgents, buildAgentCommand, migrateState, mapLimit } from "../lib.mjs";

test("loadAgents: single agent from SLATES_TOKEN with safe defaults", () => {
  const [a] = loadAgents({ SLATES_TOKEN: "slt_1" });
  assert.equal(a.name, "Claude");
  assert.equal(a.kind, "claude");
  assert.deepEqual(a.allowedTools, ["mcp__slates__*"]);
  assert.equal(a.maxBudgetUsd, "2");
});

test("loadAgents: errors are clear", () => {
  assert.throws(() => loadAgents({}), /SLATES_TOKEN is not set/);
  assert.throws(() => loadAgents({}, "[]"), /non-empty/);
  assert.throws(() => loadAgents({}, [{ name: "X", token_env: "T" }]), /T is not set/);
  assert.throws(() => loadAgents({ T: "t" }, [{ name: "X", kind: "command", token_env: "T" }]), /needs a "command" list/);
  assert.throws(() => loadAgents({ T: "t" }, [{ name: "X", kind: "robot", token_env: "T" }]), /unknown kind/);
  assert.throws(() => loadAgents({ T: "t" }, [{ name: "A", token_env: "T" }, { name: "a", token_env: "T" }]), /unique/);
});

test("loadAgents: per-agent overrides from the file", () => {
  const [a] = loadAgents({ T: "t", ALLOWED_TOOLS: "mcp__slates__*" }, [
    { name: "Coder", token_env: "T", allowed_tools: "mcp__slates__* Read Edit", max_budget_usd: 5, model: "opus" },
  ]);
  assert.deepEqual(a.allowedTools, ["mcp__slates__*", "Read", "Edit"]);
  assert.equal(a.maxBudgetUsd, "5");
  assert.equal(a.model, "opus");
  assert.equal(a.token, "t");
});

test("buildAgentCommand: claude and command kinds", () => {
  const [c] = loadAgents({ SLATES_TOKEN: "x", CLAUDE_MODEL: "opus" });
  const cc = buildAgentCommand(c, { prompt: "P", mcpFile: "/m.json", workdir: "/w" });
  assert.equal(cc.bin, "claude");
  assert.deepEqual(cc.args.slice(0, 5), ["-p", "P", "--mcp-config", "/m.json", "--strict-mcp-config"]);
  assert.deepEqual(cc.args.slice(-2), ["--model", "opus"]);

  const [x] = loadAgents({ T: "t" }, [{ name: "Codex", kind: "command", token_env: "T", command: ["codex", "exec", "--cd", "{workdir}", "{prompt}"] }]);
  assert.deepEqual(buildAgentCommand(x, { prompt: "P", mcpFile: "/m.json", workdir: "/w" }), { bin: "codex", args: ["exec", "--cd", "/w", "P"] });
});

test("migrateState handles new, old and empty files", () => {
  assert.deepEqual(migrateState(null, "Claude"), { agents: {} });
  assert.deepEqual(migrateState({ seen: { a: 1 } }, "Claude"), { agents: { Claude: { seen: { a: 1 } } } });
  const s = { agents: { X: { seen: {} } } };
  assert.equal(migrateState(s, "Claude"), s);
});

test("mapLimit never exceeds the limit and keeps order", async () => {
  let running = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
});

// ---------- telegram ----------
import { telegramMarker, parseTelegramMarker, parseAllowedChats, routeTelegramUpdate, extractResultText, telegramReplyText } from "../lib.mjs";

test("telegram marker round-trips, including group chats with negative ids", () => {
  assert.deepEqual(parseTelegramMarker(`From Telegram ${telegramMarker("-100123", 7)}.`), { chatId: "-100123", messageId: 7 });
  assert.equal(parseTelegramMarker("no marker"), null);
  assert.equal(parseTelegramMarker(undefined), null);
});

test("routeTelegramUpdate: allowlist, help, empty, task", () => {
  const allowed = parseAllowedChats("555, 777");
  const upd = (chat, text) => ({ update_id: 1, message: { message_id: 9, chat: { id: chat }, text } });
  assert.equal(routeTelegramUpdate({ update_id: 1 }, allowed).action, "ignore");
  assert.match(routeTelegramUpdate(upd(1, "hi"), allowed).text, /private.*chat id is 1/);
  assert.match(routeTelegramUpdate(upd(555, "/start"), allowed).text, /Send me any task/);
  assert.match(routeTelegramUpdate(upd(777, "  "), allowed).text, /as a text message/);
  assert.deepEqual(routeTelegramUpdate(upd(555, " plan dinner "), allowed), { action: "task", chatId: "555", messageId: 9, text: "plan dinner" });
});

test("extractResultText prefers Claude's result field, else tail of stdout", () => {
  assert.equal(extractResultText(JSON.stringify({ result: " Hi " })), "Hi");
  assert.equal(extractResultText("plain output\n"), "plain output");
  assert.ok(extractResultText("x".repeat(5000)).length <= 1501);
});

test("telegramReplyText stays under Telegram's limit", () => {
  assert.equal(telegramReplyText("Claude", true, "ok"), "✅ Slates · Claude finished.\n\nok");
  assert.equal(telegramReplyText("Claude", false, ""), "⚠️ Slates · Claude couldn't finish this one.");
  assert.ok(telegramReplyText("Claude", true, "y".repeat(9000)).length <= 4000);
});

// ---------- approvals ----------
import { approvalKeyboard, parseApprovalData, approvalPromptText, approvalResultText } from "../lib.mjs";

test("approval buttons round-trip and reject junk", () => {
  const kb = approvalKeyboard("abc123");
  const [yes, no] = kb.inline_keyboard[0];
  assert.deepEqual(parseApprovalData(yes.callback_data), { id: "abc123", answer: "yes" });
  assert.deepEqual(parseApprovalData(no.callback_data), { id: "abc123", answer: "no" });
  assert.equal(parseApprovalData("ap:abc:maybe"), null);
  assert.equal(parseApprovalData("ap:ABC:yes"), null);
  assert.ok(yes.callback_data.length <= 64); // Telegram's callback_data limit
});

test("approval texts", () => {
  const p = approvalPromptText("Claude", "Send it?", "to 6 people");
  assert.equal(p, "🔐 Slates · Claude needs your OK:\n\nSend it?\n\nto 6 people");
  assert.match(approvalResultText(p, "timeout"), /treated as No/);
});

test("button taps from chats not on the allowlist are ignored", () => {
  const upd = { update_id: 1, callback_query: { id: "q", data: "ap:x:yes", message: { message_id: 1, chat: { id: 999 } } } };
  assert.equal(routeTelegramUpdate(upd, parseAllowedChats("555")).action, "ignore");
  const ok = { update_id: 2, callback_query: { id: "q", data: "ap:x:yes", message: { message_id: 1, chat: { id: 555 } } } };
  assert.deepEqual(routeTelegramUpdate(ok, parseAllowedChats("555")), { action: "callback", callbackId: "q", chatId: "555", messageId: 1, data: "ap:x:yes" });
});
