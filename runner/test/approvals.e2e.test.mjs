// End-to-end: agent calls request_approval → Yes/No buttons on Telegram → owner taps → agent gets the answer.
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
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-ap-"));

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
        FAKE_CLAUDE_MODE: "approve",
        ...extraEnv,
      },
      timeout: 30_000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

async function waitFor(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
}

async function scenario(tapAnswer, extraEnv = {}) {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    await runOnce(slates, telegram, dir); // baseline
    const msgId = telegram.userSays("555", "Book dinner for 6 on Saturday");
    const running = runOnce(slates, telegram, dir, extraEnv);

    const ask = await waitFor(() => telegram.sent.find((m) => m.reply_markup));
    if (tapAnswer) {
      const button = ask.reply_markup.inline_keyboard[0].find((b) => b.callback_data.endsWith(`:${tapAnswer}`));
      telegram.userTaps("555", ask.message_id, button.callback_data);
    }
    const r = await running;
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const answer = fs.readFileSync(path.join(dir, "work", "Claude", "h-1", "approval-answer.txt"), "utf8");
    return { ask, answer, telegram, msgId, dir };
  } finally {
    await slates.close();
    await telegram.close();
  }
}

test("owner taps Yes: the agent is told APPROVED and the buttons are replaced", async () => {
  const { ask, answer, telegram, msgId } = await scenario("yes");
  assert.equal(ask.chat_id, "555"); // asked in the chat the task came from
  assert.match(ask.text, /^🔐 Slates · Claude needs your OK:\n\nBook table for 6 at Toit, Sat 8pm, ₹6,000\?$/);
  assert.equal(ask.reply_markup.inline_keyboard[0].length, 2);
  assert.equal(answer, "APPROVED by the owner.");
  assert.match(telegram.edits.at(-1).text, /✅ Approved$/);
  assert.equal(telegram.callbackAnswers.at(-1).text, "Approved");
  const final = telegram.sent.at(-1);
  assert.equal(final.reply_to, msgId);
  assert.match(final.text, /Approval said: APPROVED/);
});

test("owner taps No: the agent is told DECLINED", async () => {
  const { answer, telegram } = await scenario("no");
  assert.equal(answer, "DECLINED by the owner. Do not do it.");
  assert.match(telegram.edits.at(-1).text, /❌ Declined$/);
});

test("no tap in time counts as No", async () => {
  const { answer, telegram } = await scenario(null, { APPROVAL_TIMEOUT_SEC: "2" });
  assert.equal(answer, "NO ANSWER in time. Treat as declined; do not do it.");
  assert.match(telegram.edits.at(-1).text, /No answer in time \(treated as No\)$/);
});

test("Claude is allowed to call request_approval, and the token-bearing config is removed afterwards", async () => {
  const { dir } = await scenario("yes");
  const args = JSON.parse(fs.readFileSync(path.join(dir, "work", "Claude", "h-1", "fake-claude-args.json"), "utf8"));
  assert.ok(args.includes("mcp__approvals__request_approval"));
  assert.match(args[1], /call request_approval/);
  assert.ok(!fs.existsSync(path.join(dir, "work", "Claude", "h-1", ".slates-mcp.json")));
});
