// End-to-end flagship: agent coordinates 4 people → one owner approval → calls → live board → retry → decision → confirmations → note.
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
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-group-"));

const CHOICES = { Ramesh: "Sat 8pm", Priya: "noanswer-once:Sat 8pm", Amit: "Sun 1pm", Neha: null };

function runOnce(slates, telegram, dir, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [RUNNER, "--once"], {
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        SLATES_TOKEN: slates.token, RUNNER_NO_DOTENV: "1", SLATES_MCP_URL: slates.url, AGENT_NAME: "Claude", CLAUDE_BIN: FAKE_CLAUDE,
        STATE_FILE: path.join(dir, "state.json"), WORK_DIR: path.join(dir, "work"),
        TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_API_BASE: telegram.apiBase, TELEGRAM_ALLOWED_CHAT_IDS: "555",
        CALL_PROVIDER: "simulated", CALL_QUIET_HOURS: "", OWNER_NAME: "Gajanan",
        CALL_SIM_CHOICES: JSON.stringify(CHOICES),
        FAKE_CLAUDE_MODE: "group",
        ...extraEnv,
      },
      timeout: 40_000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
async function waitFor(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error("timed out waiting");
}

async function scenario(tap, extraEnv = {}) {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const dir = tmp();
  try {
    await runOnce(slates, telegram, dir, extraEnv);
    slates.addHandoff({ id: "h-dinner", from: "Telegram", to: "Claude", task: "Plan Saturday dinner with the gang" });
    const running = runOnce(slates, telegram, dir, extraEnv);
    if (tap) {
      const ask = await waitFor(() => telegram.sent.find((m) => m.reply_markup));
      const button = ask.reply_markup.inline_keyboard[0].find((b) => b.callback_data.endsWith(`:${tap}`));
      telegram.userTaps("555", ask.message_id, button.callback_data);
    }
    const r = await running;
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const result = fs.readFileSync(path.join(dir, "work", "Claude", "h-dinner", "group-result.txt"), "utf8");
    return { result, slates, telegram, stdout: r.stdout };
  } finally {
    await slates.close();
    await telegram.close();
  }
}

test("the group agrees: one approval, live board, retry, decision, confirmations, note", async () => {
  const { result, slates, telegram, stdout } = await scenario("yes");

  // One approval listing everyone, with full numbers for the owner.
  const asks = telegram.sent.filter((m) => m.reply_markup);
  assert.equal(asks.length, 1);
  assert.match(asks[0].text, /Coordinate "Saturday dinner" with 4 people by phone\?\nOptions: Sat 8pm \/ Sun 1pm/);
  assert.match(asks[0].text, /• Neha \+919800000004/);

  // Decision returned to the agent.
  assert.match(result, /^Decision: Sat 8pm\nVotes: Sat 8pm: 2, Sun 1pm: 1/);
  assert.match(result, /- Priya: Sat 8pm \(confirmed\)/); // missed the first call, answered the retry
  assert.match(result, /- Neha: no_answer/);
  assert.match(result, /Board: https:\/\/slates\.test\/s\/group-h-dinner/);

  // The live board ends in the right state, phones masked.
  const rows = Object.fromEntries(slates.boards["group-h-dinner"].rows.map((r) => [r.cells.person, r.cells]));
  assert.deepEqual(rows.Ramesh, { person: "Ramesh", phone: "••••0001", status: "confirmed ✓", answer: "Sat 8pm" });
  assert.equal(rows.Priya.status, "confirmed ✓");
  assert.equal(rows.Amit.status, "confirmed ✓"); // told the decision even though they voted Sun
  assert.deepEqual(rows.Neha, { person: "Neha", phone: "••••0004", status: "no answer", answer: "" });
  const create = slates.calls.find((c) => c.name === "create_slate" && c.args.slug !== "agents-at-work");
  assert.equal(create.args.kind, "table");
  assert.equal(create.args.slug, "group-h-dinner");
  assert.ok(!JSON.stringify(slates.calls.filter((c) => ["create_slate", "patch_items"].includes(c.name))).includes("+9198000"), "full numbers must never reach the board");

  // Summary note saved.
  const note = slates.calls.find((c) => c.name === "add_note");
  assert.equal(note.args.id, "group-h-dinner");
  assert.match(note.args.body, /## Decision\n\*\*Sat 8pm\*\*/);

  // Neha was tried twice (first round + retry); nobody else beyond plan.
  assert.equal((stdout.match(/👥 Neha: no_answer/g) || []).length, 2);
});

test("owner says No: nobody is called and no board is made", async () => {
  const { result, slates } = await scenario("no");
  assert.equal(result, "ERROR Group not coordinated: the owner declined");
  assert.ok(!slates.calls.some((c) => c.name === "create_slate" && c.args.slug !== "agents-at-work"));
});

test("a tie is not decided by the agent and nobody gets a confirmation call", async () => {
  const { result, slates } = await scenario("yes", { CALL_SIM_CHOICES: JSON.stringify({ Ramesh: "Sat 8pm", Priya: "Sun 1pm", Amit: null, Neha: null }) });
  assert.match(result, /^Decision: tie, ask the owner to choose/);
  const rows = slates.boards["group-h-dinner"].rows.map((r) => r.cells.status);
  assert.ok(!rows.some((s) => s.startsWith("confirmed")));
});

test("bad input is rejected before the owner is bothered", async () => {
  const bad = JSON.stringify({ title: "Lunch", question: "which?", options: ["a", "b"], people: [{ name: "A", phone: "+911111111111" }, { name: "B", phone: "222" }] });
  const { result, telegram } = await scenario(null, { FAKE_GROUP_JSON: bad });
  assert.match(result, /^ERROR Group not coordinated: B: phone must include the country code/);
  assert.ok(!telegram.sent.some((m) => m.reply_markup));
});
