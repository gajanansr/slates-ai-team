import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWorkUpdate, workBoardCreateArgs, resultLine, clockTime, WORK_COLUMNS, WORK_BOARD, STATUS } from "../work-board.mjs";
import { buildMcpConfig, extraAllowedTools, buildPrompt, browserToolsOn, PLAYWRIGHT_MCP_VERSION } from "../lib.mjs";

const at = new Date("2026-11-21T04:35:00Z"); // 10:05 in Asia/Kolkata

test("clockTime is HH:MM in the given zone, Asia/Kolkata by default", () => {
  assert.equal(clockTime(at), "10:05");
  assert.equal(clockTime(at, "UTC"), "04:35");
});

test("a new row starts with agent, task (max 120 chars), status and start time", () => {
  const { rows, row, removed } = applyWorkUpdate([], "h-1", { agent: "Claude", task: "x".repeat(300), status: STATUS.working, update: "Started" }, { now: at });
  assert.equal(rows.length, 1);
  assert.deepEqual(removed, []);
  assert.equal(row.id, "h-1");
  assert.equal(row.cells.task.length, 120);
  assert.ok(row.cells.task.endsWith("…"));
  assert.deepEqual({ ...row.cells, task: "" }, { agent: "Claude", task: "", status: "working", started: "10:05", update: "Started", result: "" });
});

test("updating a row keeps its other cells and start time, and does not mutate the input", () => {
  const first = applyWorkUpdate([], "h-1", { agent: "Claude", task: "Book dinner", status: STATUS.working }, { now: at });
  const before = structuredClone(first.rows);
  const later = applyWorkUpdate(first.rows, "h-1", { status: STATUS.done, result: "Booked Toit 8pm" }, { now: new Date("2026-11-21T09:00:00Z") });
  assert.deepEqual(first.rows, before);
  assert.equal(later.rows.length, 1);
  assert.deepEqual(later.row.cells, { agent: "Claude", task: "Book dinner", status: "done", started: "10:05", update: "", result: "Booked Toit 8pm" });
});

test("keeps at most 25 rows by removing the oldest done/failed ones, never active ones", () => {
  let rows = [];
  for (let i = 1; i <= 25; i++) {
    rows = applyWorkUpdate(rows, `t${i}`, { agent: "A", task: `task ${i}`, status: i <= 2 ? STATUS.working : i % 2 ? STATUS.done : STATUS.failed }, { now: at }).rows;
  }
  let r = applyWorkUpdate(rows, "t26", { agent: "A", task: "new", status: STATUS.working }, { now: at });
  assert.deepEqual(r.removed, ["t3"]); // t1, t2 are still working
  assert.equal(r.rows.length, 25);
  r = applyWorkUpdate(r.rows, "t27", { status: STATUS.working }, { now: at, max: 23 });
  assert.deepEqual(r.removed, ["t4", "t5", "t6"]);
  assert.equal(r.rows.length, 23);
  assert.ok(r.rows.some((x) => x.id === "t1") && r.rows.some((x) => x.id === "t2"));
  // Updating an existing row never trims.
  assert.deepEqual(applyWorkUpdate(r.rows, "t1", { update: "still going" }, { now: at, max: 23 }).removed, []);
});

test("when every other row is active, the board may go over the limit instead of hiding work", () => {
  let rows = [];
  for (let i = 1; i <= 3; i++) rows = applyWorkUpdate(rows, `t${i}`, { status: STATUS.needsYou }, { now: at, max: 3 }).rows;
  const r = applyWorkUpdate(rows, "t4", { status: STATUS.done }, { now: at, max: 3 });
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.removed, []);
});

test("resultLine: first real line, markdown stripped, a link kept", () => {
  assert.equal(resultLine("## Done!\n\nBooked a table."), "Done!");
  assert.equal(resultLine("**Booked** Toit for 6 at 8pm.\nDetails below"), "Booked Toit for 6 at 8pm.");
  assert.equal(resultLine("Wrote the summary.\nSee https://www.slates.space/s/trip-plan"), "Wrote the summary. https://www.slates.space/s/trip-plan");
  assert.equal(resultLine("Note: https://a.io/x is ready"), "Note: https://a.io/x is ready");
  assert.ok(resultLine("y".repeat(500)).length <= 140);
  assert.equal(resultLine(""), "");
});

test("create args: pinned table board in Work with the six columns", () => {
  const { rows } = applyWorkUpdate([], "h-1", { agent: "Claude", task: "t", status: STATUS.working }, { now: at });
  const a = workBoardCreateArgs(rows);
  assert.equal(a.slug, "agents-at-work");
  assert.equal(a.title, "Agents at work");
  assert.equal(a.icon, "bot");
  assert.equal(a.category, "Work");
  assert.equal(a.kind, "table");
  assert.equal(a.pinned, true);
  assert.deepEqual(a.data.columns.map((c) => c.key), ["agent", "task", "status", "started", "update", "result"]);
  assert.equal(a.data.columns, WORK_COLUMNS);
  assert.equal(a.data.rows[0].id, "h-1");
  assert.equal(WORK_BOARD.slug, a.slug);
});

// ---------- browser tools (Playwright MCP) ----------

const claude = { name: "Claude", kind: "claude" };
const base = { slatesUrl: "https://slates.test/mcp", token: "slt_x" };

test("BROWSER_TOOLS=1: MCP config has the pinned playwright server and mcp__playwright__* is allowed", () => {
  const env = { BROWSER_TOOLS: "1" };
  assert.equal(browserToolsOn(env), true);
  const conf = buildMcpConfig({ ...base, browser: browserToolsOn(env), env });
  assert.deepEqual(conf.mcpServers.playwright, {
    type: "stdio", command: "npx", args: ["-y", `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, "--headless", "--isolated"],
  });
  assert.match(PLAYWRIGHT_MCP_VERSION, /^\d+\.\d+\.\d+$/, "pin an exact version");
  assert.ok(extraAllowedTools(claude, { browser: true }).includes("mcp__playwright__browser_navigate"));
  assert.ok(!extraAllowedTools(claude, { browser: true }).some((x) => /\*|run_code_unsafe|browser_evaluate/.test(x)), "no wildcard, no arbitrary JS");
  // BROWSER_NAME picks the browser (e.g. chromium on Linux ARM64).
  const arm = buildMcpConfig({ ...base, browser: true, env: { BROWSER_NAME: "chromium" } });
  assert.deepEqual(arm.mcpServers.playwright.args.slice(-2), ["--browser", "chromium"]);
});

test("without BROWSER_TOOLS: no playwright server and no playwright tools", () => {
  for (const env of [{}, { BROWSER_TOOLS: "0" }, { BROWSER_TOOLS: "false" }]) {
    const on = browserToolsOn(env);
    assert.equal(on, false);
    const conf = buildMcpConfig({ ...base, browser: on, env });
    assert.deepEqual(Object.keys(conf.mcpServers), ["slates"]);
    assert.ok(!extraAllowedTools(claude, { browser: on }).some((x) => x.includes("playwright")));
  }
  // Command agents never get Claude's extra tools.
  assert.deepEqual(extraAllowedTools({ name: "Codex", kind: "command" }, { browser: true, approvals: true }), []);
});

test("buildMcpConfig keeps the approvals and calls servers as before", () => {
  const conf = buildMcpConfig({ ...base, nodePath: "/usr/bin/node", approvals: { script: "/a.mjs", env: { A: "1" } }, calls: { script: "/c.mjs", env: { C: "1" } } });
  assert.deepEqual(conf.mcpServers.slates, { type: "http", url: base.slatesUrl, headers: { Authorization: "Bearer slt_x" } });
  assert.deepEqual(conf.mcpServers.approvals, { type: "stdio", command: "/usr/bin/node", args: ["/a.mjs"], env: { A: "1" } });
  assert.deepEqual(conf.mcpServers.calls, { type: "stdio", command: "/usr/bin/node", args: ["/c.mjs"], env: { C: "1" } });
  assert.deepEqual(extraAllowedTools(claude, { approvals: true, calls: true, gemini: true, incidentTools: ["Bash(gh:*)"] }), [
    "mcp__approvals__request_approval", "mcp__calls__call_person", "mcp__calls__coordinate_group", "mcp__calls__ask_owner_by_call", "mcp__calls__ask_gemini", "Bash(gh:*)",
  ]);
});

test("prompt mentions the browser and the approval rule only when the browser is on", () => {
  const t = { id: "h1", kind: "handoff", from: "user", task: "Find a dentist" };
  const on = buildPrompt(t, { browser: true, approvals: true });
  assert.match(on, /real web browser/);
  assert.match(on, /spends money, books, signs up for something, or sends a message, call request_approval/);
  assert.doesNotMatch(on, /not available on this runner/);
  assert.match(buildPrompt(t, { browser: true, approvals: false }), /request_approval is not available on this runner, so stop before submitting/);
  assert.doesNotMatch(buildPrompt(t, {}), /browser/);
});
