// End-to-end: agent calls call_person → owner approves on Telegram → simulated call → transcript saved to Slates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSlates } from "./fake-slates.mjs";
import { startFakeTelegram } from "./fake-telegram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "..", "runner.mjs");
const FAKE_CLAUDE = path.join(HERE, "fake-claude.mjs");
fs.chmodSync(FAKE_CLAUDE, 0o755);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-call-"));

function runOnce(slates, telegram, dir, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [RUNNER, "--once"], {
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        SLATES_TOKEN: slates.token, RUNNER_NO_DOTENV: "1", SLATES_MCP_URL: slates.url, AGENT_NAME: "Claude",
        CLAUDE_BIN: FAKE_CLAUDE,
        STATE_FILE: path.join(dir, "state.json"), WORK_DIR: path.join(dir, "work"),
        TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_API_BASE: telegram.apiBase, TELEGRAM_ALLOWED_CHAT_IDS: "555",
        CALL_PROVIDER: "simulated", CALL_QUIET_HOURS: "", OWNER_NAME: "Gajanan",
        FAKE_CLAUDE_MODE: "call",
        ...extraEnv,
      },
      timeout: 30_000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

async function waitFor(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error("timed out waiting");
}

// tap: "yes" | "no" | null (don't wait for an ask at all)
async function scenario(tap, extraEnv = {}) {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    await runOnce(slates, telegram, dir, extraEnv);
    slates.addHandoff({ id: "h-dinner", from: "ChatGPT", to: "Claude", task: "Confirm dinner with Ramesh" });
    const running = runOnce(slates, telegram, dir, extraEnv);
    let ask = null;
    if (tap) {
      ask = await waitFor(() => telegram.sent.find((m) => m.reply_markup));
      const button = ask.reply_markup.inline_keyboard[0].find((b) => b.callback_data.endsWith(`:${tap}`));
      telegram.userTaps("555", ask.message_id, button.callback_data);
    }
    const r = await running;
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const result = fs.readFileSync(path.join(dir, "work", "Claude", "h-dinner", "call-result.txt"), "utf8");
    return { ask, result, slates, telegram, stdout: r.stdout, dir };
  } finally {
    await slates.close();
    await telegram.close();
  }
}

test("approved call happens, discloses it's an AI, and the transcript is saved to Slates", async () => {
  const { ask, result, slates } = await scenario("yes");
  assert.match(ask.text, /Call Ramesh \(\+919876543210\)\?\nGoal: Confirm Saturday 8pm dinner for 6/);
  assert.match(result, /^Call status: completed/);
  assert.match(result, /Agent: Hi Ramesh, this is an AI assistant calling on behalf of Gajanan\./);
  assert.match(result, /Saved to Slates: https:\/\/slates\.test\/notes\/call-h-dinner-1/);
  const note = slates.calls.find((c) => c.name === "add_note");
  assert.equal(note.args.id, "call-h-dinner-1");
  assert.deepEqual(note.args.tags, ["calls"]);
  assert.match(note.args.body, /## Transcript/);
  assert.match(note.args.body, /AI assistant calling on behalf of Gajanan/);
});

test("declined call is not made and nothing is saved", async () => {
  const { result, slates } = await scenario("no");
  assert.equal(result, "ERROR Call not made: the owner declined this call");
  assert.ok(!slates.calls.some((c) => c.name === "add_note"));
});

test("quiet hours stop the call before the owner is even asked", async () => {
  const { result, telegram } = await scenario(null, { CALL_QUIET_HOURS: "0-24" });
  assert.match(result, /^ERROR Call not made: It's \d+:00, inside quiet hours/);
  assert.ok(!telegram.sent.some((m) => m.reply_markup));
});

test("numbers without a country code or outside allowed prefixes are refused", async () => {
  const a = await scenario(null, { FAKE_CALL_PHONE: "98765 43210" });
  assert.match(a.result, /must include the country code/);
  const b = await scenario(null, { CALL_ALLOWED_PREFIXES: "+1" });
  assert.match(b.result, /not allowed \(allowed prefixes: \+1\)/);
});

test("no call provider: the agent never gets the call tool", async () => {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    const env = { CALL_PROVIDER: "", FAKE_CLAUDE_MODE: "" };
    await runOnce(slates, telegram, dir, env);
    slates.addHandoff({ id: "h-x", from: "ChatGPT", to: "Claude", task: "x" });
    await runOnce(slates, telegram, dir, env);
    const args = JSON.parse(fs.readFileSync(path.join(dir, "work", "Claude", "h-x", "fake-claude-args.json"), "utf8"));
    assert.ok(!args.includes("mcp__calls__call_person"));
    assert.doesNotMatch(args[1], /call_person/);
  } finally {
    await slates.close();
    await telegram.close();
  }
});
