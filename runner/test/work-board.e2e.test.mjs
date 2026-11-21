// End-to-end: the "Agents at work" board follows a task from start to finish, and board trouble never breaks a task.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSlates } from "./fake-slates.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "..", "runner.mjs");
const FAKE_CLAUDE = path.join(HERE, "fake-claude.mjs");
fs.chmodSync(FAKE_CLAUDE, 0o755);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-wb-"));
const SLUG = "agents-at-work";

function runOnce(slates, dir, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [RUNNER, "--once"], {
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        SLATES_TOKEN: slates.token, RUNNER_NO_DOTENV: "1", SLATES_MCP_URL: slates.url, AGENT_NAME: "Claude",
        CLAUDE_BIN: FAKE_CLAUDE, STATE_FILE: path.join(dir, "state.json"), WORK_DIR: path.join(dir, "work"),
        ...extraEnv,
      },
      timeout: 30_000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

const boardCalls = (slates) => slates.calls.filter((c) => ["create_slate", "patch_items"].includes(c.name) && c.args.slug === SLUG);

test("a task shows as working on a new pinned board, then done with the agent's result", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    await runOnce(slates, dir); // baseline
    assert.equal(boardCalls(slates).length, 0, "no board until there is work");
    slates.addHandoff({ id: "h-dinner", from: "ChatGPT", to: "Claude", task: "Book dinner for 6 on Saturday at 8pm" });
    const r = await runOnce(slates, dir, { FAKE_CLAUDE_RESULT: "Booked Toit for 6, Sat 8pm.\nConfirmation on https://www.slates.space/s/dinner" });
    assert.equal(r.code, 0, r.stderr);

    const [patch1, create, patch2] = boardCalls(slates);
    // First write: the board didn't exist, so it was created with the "working" row.
    assert.equal(patch1.name, "patch_items");
    assert.equal(create.name, "create_slate");
    assert.equal(create.args.title, "Agents at work");
    assert.equal(create.args.icon, "bot");
    assert.equal(create.args.category, "Work");
    assert.equal(create.args.pinned, true);
    assert.equal(create.args.kind, "table");
    const working = create.args.data.rows[0];
    assert.equal(working.id, "h-dinner");
    assert.equal(working.cells.status, "working");
    assert.equal(working.cells.agent, "Claude");
    assert.equal(working.cells.task, "Book dinner for 6 on Saturday at 8pm");
    assert.match(working.cells.started, /^\d\d:\d\d$/);
    // The working row is there before the agent resolves the task; done comes after.
    const names = slates.calls.map((c) => c);
    assert.ok(names.indexOf(create) < names.findIndex((c) => c.name === "resolve_desk_item"));
    assert.equal(patch2.name, "patch_items");
    assert.ok(names.indexOf(patch2) > names.findIndex((c) => c.name === "resolve_desk_item"));

    const row = slates.boards[SLUG].rows.find((x) => x.id === "h-dinner");
    assert.equal(row.cells.status, "done");
    assert.equal(row.cells.result, "Booked Toit for 6, Sat 8pm. https://www.slates.space/s/dinner");
    assert.equal(row.cells.started, working.cells.started);

    // A second task reuses the board (no second create) and keeps the first row.
    slates.addHandoff({ id: "h-fail", from: "ChatGPT", to: "Claude", task: "This one fails" });
    await runOnce(slates, dir, { FAKE_CLAUDE_MODE: "fail" });
    assert.equal(slates.calls.filter((c) => c.name === "create_slate" && c.args.slug === SLUG).length, 1);
    const rows = Object.fromEntries(slates.boards[SLUG].rows.map((x) => [x.id, x.cells]));
    assert.equal(rows["h-dinner"].status, "done");
    assert.equal(rows["h-fail"].status, "failed");
    assert.match(rows["h-fail"].update, /exit code 1/);
  } finally {
    await slates.close();
  }
});

test("the board trims old finished rows past 25 with patch_items remove", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    await runOnce(slates, dir); // baseline, writes state.json
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `old-${i}`, cells: { agent: "Claude", task: `old ${i}`, status: "done", started: "09:00", update: "", result: "" } }));
    state.workBoard = { rows };
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
    slates.boards[SLUG] = { columns: [], rows: structuredClone(rows) };
    slates.addHandoff({ id: "h-new", from: "ChatGPT", to: "Claude", task: "New task" });
    const r = await runOnce(slates, dir);
    assert.equal(r.code, 0, r.stderr);
    const first = boardCalls(slates)[0];
    assert.deepEqual(first.args.remove, ["old-0"]);
    assert.equal(slates.boards[SLUG].rows.length, 25);
    assert.equal(slates.boards[SLUG].rows.at(-1).cells.status, "done");
  } finally {
    await slates.close();
  }
});

test("board writes failing never break the task", async () => {
  const slates = await startFakeSlates({ failTools: ["patch_items", "create_slate"] });
  const dir = tmp();
  try {
    await runOnce(slates, dir);
    slates.addHandoff({ id: "h-ok", from: "ChatGPT", to: "Claude", task: "Still works" });
    const r = await runOnce(slates, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /✓ Claude h-ok exit=0/);
    assert.match(r.stdout, /work board write failed/);
    assert.deepEqual(slates.calls.filter((c) => c.name === "resolve_desk_item").map((c) => c.args.id), ["h-ok"]);
  } finally {
    await slates.close();
  }
});

test("WORK_BOARD=false turns the board off", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    await runOnce(slates, dir);
    slates.addHandoff({ id: "h-x", from: "ChatGPT", to: "Claude", task: "Quiet" });
    await runOnce(slates, dir, { WORK_BOARD: "false" });
    assert.equal(boardCalls(slates).length, 0);
  } finally {
    await slates.close();
  }
});

test("BROWSER_TOOLS=1 gives Claude the playwright server and tools; off by default", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    await runOnce(slates, dir);
    slates.addHandoff({ id: "h-web", from: "ChatGPT", to: "Claude", task: "Look something up" });
    await runOnce(slates, dir, { BROWSER_TOOLS: "1", WORK_BOARD: "false" });
    slates.addHandoff({ id: "h-plain", from: "ChatGPT", to: "Claude", task: "No browser" });
    await runOnce(slates, dir, { WORK_BOARD: "false" });
    const read = (id, f) => JSON.parse(fs.readFileSync(path.join(dir, "work", "Claude", id, f), "utf8"));
    assert.deepEqual(read("h-web", "mcp-servers.json"), ["slates", "playwright"]);
    assert.ok(read("h-web", "fake-claude-args.json").includes("mcp__playwright__browser_navigate"));
    assert.deepEqual(read("h-plain", "mcp-servers.json"), ["slates"]);
    assert.ok(!read("h-plain", "fake-claude-args.json").includes("mcp__playwright__browser_navigate"));
  } finally {
    await slates.close();
  }
});
