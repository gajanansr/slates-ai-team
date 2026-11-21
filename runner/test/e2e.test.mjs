// End-to-end: real runner.mjs + fake Slates server + fake claude. No network, no token.
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

function runRunner(slates, dir, extraArgs = [], extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [RUNNER, "--once", ...extraArgs],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SLATES_TOKEN: slates.token,
          RUNNER_NO_DOTENV: "1", SLATES_MCP_URL: slates.url,
          AGENT_NAME: "Claude",
          CLAUDE_BIN: FAKE_CLAUDE,
          STATE_FILE: path.join(dir, "state.json"),
          WORK_DIR: path.join(dir, "work"),
          ...extraEnv,
        },
        timeout: 30_000,
      },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-e2e-"));
fs.chmodSync(FAKE_CLAUDE, 0o755);

test("first run skips tasks already waiting", async () => {
  const slates = await startFakeSlates({ desk: { handoffs: [{ id: "h-old", from: "ChatGPT", to: "Claude", task: "Old task" }] } });
  const dir = tmp();
  try {
    const r = await runRunner(slates, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1 item\(s\) already on the desk were marked as seen/);
    assert.ok(!slates.calls.some((c) => c.name === "resolve_desk_item"));
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.agents.Claude.seen["h-old"].status, "skipped-at-start");
  } finally {
    await slates.close();
  }
});

test("a new task is run, resolved in Slates, and recorded", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    await runRunner(slates, dir); // baseline (empty desk)
    slates.addHandoff({ id: "h-new", from: "ChatGPT", to: "Claude", task: "Add a note called Runner test" });
    slates.addHandoff({ id: "h-other", from: "Claude", to: "Gemini", task: "Not for Claude" });

    const r = await runRunner(slates, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /✓ Claude h-new exit=0 success cost=\$0\.010 turns=2/);

    const resolved = slates.calls.filter((c) => c.name === "resolve_desk_item").map((c) => c.args.id);
    assert.deepEqual(resolved, ["h-new"]);

    // The runner itself posts start and finish to the activity feed, in order around the agent's work.
    const names = slates.calls.map((c) => c.name);
    const activity = slates.calls.filter((c) => c.name === "log_activity").map((c) => c.args.message);
    assert.equal(activity.length, 2);
    assert.match(activity[0], /^Runner started Claude on h-new: Add a note called Runner test$/);
    assert.match(activity[1], /^Runner: Claude finished h-new \(success cost=\$0\.010 turns=2\)$/);
    assert.ok(names.indexOf("log_activity") < names.indexOf("resolve_desk_item"));
    assert.ok(names.lastIndexOf("log_activity") > names.indexOf("resolve_desk_item"));

    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.agents.Claude.seen["h-new"].status, "done");
    assert.equal(state.agents.Claude.seen["h-other"], undefined);

    const taskDir = path.join(dir, "work", "Claude", "h-new");
    assert.ok(!fs.existsSync(path.join(taskDir, ".slates-mcp.json")), "token file must be deleted after the run");
    const args = JSON.parse(fs.readFileSync(path.join(taskDir, "fake-claude-args.json"), "utf8"));
    assert.ok(args.includes("--strict-mcp-config"));
    assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__slates__*");
    assert.equal(args[args.indexOf("--max-budget-usd") + 1], "2");

    // Running again must not repeat the task.
    const again = await runRunner(slates, dir);
    assert.equal(again.code, 0);
    assert.equal(slates.calls.filter((c) => c.name === "resolve_desk_item").length, 1);
  } finally {
    await slates.close();
  }
});

test("a failing agent run is recorded as failed and not retried", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    await runRunner(slates, dir);
    slates.addHandoff({ id: "h-bad", from: "ChatGPT", to: "Claude", task: "This will fail" });
    const r = await runRunner(slates, dir, [], { FAKE_CLAUDE_MODE: "fail" });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /✗ Claude h-bad exit=1/);
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.agents.Claude.seen["h-bad"].status, "failed");
    const activity = slates.calls.filter((c) => c.name === "log_activity").map((c) => c.args.message);
    assert.match(activity.at(-1), /^Runner: Claude FAILED on h-bad \(exit 1\)\. Log on the runner: .*work\/Claude\/h-bad\/run\.log$/);
    assert.ok(!fs.existsSync(path.join(dir, "work", "Claude", "h-bad", ".slates-mcp.json")));
  } finally {
    await slates.close();
  }
});

test("a wrong token is reported as a poll error, nothing runs", async () => {
  const slates = await startFakeSlates();
  const dir = tmp();
  try {
    const r = await runRunner({ ...slates, token: "slt_wrong" }, dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /poll error/);
    assert.ok(!fs.existsSync(path.join(dir, "state.json")));
  } finally {
    await slates.close();
  }
});

// ---------- several agents + concurrency ----------

function twoAgentSetup(dir, { maxConcurrent = "2", sleepMs = "0" } = {}) {
  const agentsFile = path.join(dir, "agents.json");
  fs.writeFileSync(agentsFile, JSON.stringify([
    { name: "Claude", kind: "claude", token_env: "SLATES_TOKEN_CLAUDE" },
    // A "command" agent, like a codex exec wrapper: prompt as an argument, Slates details from env.
    { name: "Codex", kind: "command", token_env: "SLATES_TOKEN_CODEX", command: [FAKE_CLAUDE, "{prompt}"] },
  ]));
  return {
    AGENTS_FILE: agentsFile,
    SLATES_TOKEN: "",
    SLATES_TOKEN_CLAUDE: "slt_claude",
    SLATES_TOKEN_CODEX: "slt_codex",
    MAX_CONCURRENT: maxConcurrent,
    FAKE_CLAUDE_SLEEP_MS: sleepMs,
  };
}

test("two agents each run their own tasks with their own tokens", async () => {
  const slates = await startFakeSlates({ tokens: { slt_claude: "Claude", slt_codex: "Codex" } });
  const dir = tmp();
  const env = twoAgentSetup(dir);
  try {
    const base = await runRunner(slates, dir, [], env);
    assert.equal(base.code, 0, base.stderr);
    slates.addHandoff({ id: "h-c", from: "ChatGPT", to: "Claude", task: "For Claude" });
    slates.addHandoff({ id: "h-x", from: "ChatGPT", to: "Codex", task: "For Codex" });

    const r = await runRunner(slates, dir, [], env);
    assert.equal(r.code, 0, r.stderr);
    const resolvedBy = Object.fromEntries(slates.calls.filter((c) => c.name === "resolve_desk_item").map((c) => [c.args.id, c.agent]));
    assert.deepEqual(resolvedBy, { "h-c": "Claude", "h-x": "Codex" });

    // Activity is posted under each agent's own identity.
    const starts = slates.calls.filter((c) => c.name === "log_activity" && c.args.message.startsWith("Runner started"));
    assert.deepEqual(starts.map((c) => c.agent).sort(), ["Claude", "Codex"]);

    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.agents.Claude.seen["h-c"].status, "done");
    assert.equal(state.agents.Codex.seen["h-x"].status, "done");

    // The command agent got the prompt as a plain argument and no token file was left behind.
    const codexArgs = JSON.parse(fs.readFileSync(path.join(dir, "work", "Codex", "h-x", "fake-claude-args.json"), "utf8"));
    assert.equal(codexArgs.length, 1);
    assert.match(codexArgs[0], /resolve_desk_item with id "h-x"/);
    assert.ok(!fs.existsSync(path.join(dir, "work", "Codex", "h-x", ".slates-mcp.json")));
  } finally {
    await slates.close();
  }
});

async function timings(maxConcurrent) {
  const slates = await startFakeSlates({ tokens: { slt_claude: "Claude", slt_codex: "Codex" } });
  const dir = tmp();
  const env = twoAgentSetup(dir, { maxConcurrent, sleepMs: "700" });
  try {
    await runRunner(slates, dir, [], env);
    slates.addHandoff({ id: "h-c", from: "ChatGPT", to: "Claude", task: "A" });
    slates.addHandoff({ id: "h-x", from: "ChatGPT", to: "Codex", task: "B" });
    const r = await runRunner(slates, dir, [], env);
    assert.equal(r.code, 0, r.stderr);
    const read = (a, id) => JSON.parse(fs.readFileSync(path.join(dir, "work", a, id, "fake-claude-timing.json"), "utf8"));
    return [read("Claude", "h-c"), read("Codex", "h-x")];
  } finally {
    await slates.close();
  }
}
const overlap = ([a, b]) => a.started < b.ended && b.started < a.ended;

test("MAX_CONCURRENT=2 runs tasks at the same time", async () => {
  assert.ok(overlap(await timings("2")), "runs should overlap");
});

test("MAX_CONCURRENT=1 runs tasks one after another", async () => {
  assert.ok(!overlap(await timings("1")), "runs must not overlap");
});

test("an old single-agent state file is migrated, not re-run", async () => {
  const slates = await startFakeSlates({ desk: { handoffs: [{ id: "h-done", from: "ChatGPT", to: "Claude", task: "Already done" }] } });
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ seen: { "h-done": { status: "done" } } }));
  try {
    const r = await runRunner(slates, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!slates.calls.some((c) => c.name === "resolve_desk_item"));
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.agents.Claude.seen["h-done"].status, "done");
  } finally {
    await slates.close();
  }
});
