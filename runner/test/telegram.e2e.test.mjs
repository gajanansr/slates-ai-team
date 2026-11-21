// End-to-end: Telegram message → Slates hand_off → runner runs the agent → answer back in the same chat.
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

function runOnce(slates, telegram, dir, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [RUNNER, "--once"], {
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        SLATES_TOKEN: slates.token, RUNNER_NO_DOTENV: "1", SLATES_MCP_URL: slates.url, AGENT_NAME: "Claude",
        CLAUDE_BIN: FAKE_CLAUDE,
        STATE_FILE: path.join(dir, "state.json"), WORK_DIR: path.join(dir, "work"),
        TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_API_BASE: telegram.apiBase,
        TELEGRAM_ALLOWED_CHAT_IDS: "555",
        ...extraEnv,
      },
      timeout: 30_000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-tg-"));

test("a Telegram message becomes a task, runs, and the answer comes back to the chat", async () => {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    await runOnce(slates, telegram, dir); // baseline: empty desk, no messages
    const msgId = telegram.userSays("555", "Add a note called groceries with milk and eggs");

    const r = await runOnce(slates, telegram, dir);
    assert.equal(r.code, 0, r.stderr);

    // Slates got a hand_off to Claude with the reply marker in the context.
    const handoff = slates.calls.find((c) => c.name === "hand_off");
    assert.equal(handoff.args.to, "Claude");
    assert.equal(handoff.args.task, "Add a note called groceries with milk and eggs");
    assert.match(handoff.args.context, new RegExp(`\\[telegram:555:${msgId}\\]`));

    // The runner picked it up in the same pass and the agent resolved it.
    assert.ok(slates.calls.some((c) => c.name === "resolve_desk_item" && c.args.id === "h-1"));

    // The chat got an acknowledgement, then the agent's answer, both as replies to the user's message.
    assert.equal(telegram.sent.length, 2);
    assert.match(telegram.sent[0].text, /Slates got it\. Claude is on it/);
    assert.equal(telegram.sent[1].chat_id, "555");
    assert.equal(telegram.sent[1].reply_to, msgId);
    assert.equal(telegram.sent[1].text, "✅ Slates · Claude finished.\n\nDone with h-1.");

    // The agent was told its answer goes to Telegram.
    const args = JSON.parse(fs.readFileSync(path.join(dir, "work", "Claude", "h-1", "fake-claude-args.json"), "utf8"));
    assert.match(args[1], /came from the user's Telegram/);

    // Nothing is handled twice on the next pass.
    await runOnce(slates, telegram, dir);
    assert.equal(slates.calls.filter((c) => c.name === "hand_off").length, 1);
    assert.equal(telegram.sent.length, 2);
  } finally {
    await slates.close();
    await telegram.close();
  }
});

test("strangers are refused and nothing reaches Slates", async () => {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    telegram.userSays("999", "Delete all my boards");
    const r = await runOnce(slates, telegram, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!slates.calls.some((c) => c.name === "hand_off"));
    assert.equal(telegram.sent.length, 1);
    assert.match(telegram.sent[0].text, /This bot is private\. Your chat id is 999/);
  } finally {
    await slates.close();
    await telegram.close();
  }
});

test("a failed run tells the user it couldn't finish", async () => {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    await runOnce(slates, telegram, dir);
    telegram.userSays("555", "Book a flight");
    const r = await runOnce(slates, telegram, dir, { FAKE_CLAUDE_MODE: "fail" });
    assert.equal(r.code, 0, r.stderr);
    assert.match(telegram.sent.at(-1).text, /^⚠️ Slates · Claude couldn't finish this one\./);
  } finally {
    await slates.close();
    await telegram.close();
  }
});

test("no allowed chats configured: everyone gets their chat id, no tasks", async () => {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    telegram.userSays("555", "hello");
    await runOnce(slates, telegram, dir, { TELEGRAM_ALLOWED_CHAT_IDS: "" });
    assert.ok(!slates.calls.some((c) => c.name === "hand_off"));
    assert.match(telegram.sent[0].text, /Your chat id is 555/);
  } finally {
    await slates.close();
    await telegram.close();
  }
});
