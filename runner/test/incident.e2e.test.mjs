// End to end: a watched site goes down → incident board + alert → agent investigates and phones the owner for a
// decision (voice, with Telegram buttons as fallback) → site comes back → board and owner are told.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeSlates } from "./fake-slates.mjs";
import { startFakeTelegram } from "./fake-telegram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "..", "runner.mjs");
const FAKE_CLAUDE = path.join(HERE, "fake-claude.mjs");
fs.chmodSync(FAKE_CLAUDE, 0o755);

async function startSite() {
  const site = { status: 200 };
  const server = http.createServer((req, res) => res.writeHead(site.status === "broken" ? 200 : site.status).end(site.status === 200 ? "<p>All systems running</p>" : "Moved"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  site.url = `http://127.0.0.1:${server.address().port}/`;
  site.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return site;
}

function runOnce(slates, telegram, site, dir, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [RUNNER, "--once"], {
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        SLATES_TOKEN: slates.token, RUNNER_NO_DOTENV: "1", SLATES_MCP_URL: slates.url, AGENT_NAME: "Claude", CLAUDE_BIN: FAKE_CLAUDE,
        STATE_FILE: path.join(dir, "state.json"), WORK_DIR: path.join(dir, "work"),
        TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_API_BASE: telegram.apiBase, TELEGRAM_ALLOWED_CHAT_IDS: "555",
        CALL_PROVIDER: "simulated", CALL_QUIET_HOURS: "", OWNER_NAME: "Gajanan",
        WATCH_URLS: `demo=${site.url}`, WATCH_EXPECT: "demo=All systems running", WATCH_REPOS: "demo=gajanansr/slates-oncall-demo", WATCH_FAILS: "1",
        FAKE_CLAUDE_MODE: "incident",
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

async function scenario({ tap = null, extraEnv = {}, broken = false } = {}) {
  const slates = await startFakeSlates();
  const telegram = await startFakeTelegram();
  const site = await startSite();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slates-runner-incident-"));
  try {
    // 1. Site up: nothing happens (also baselines the desk).
    let r = await runOnce(slates, telegram, site, dir, extraEnv);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.ok(!slates.calls.some((c) => c.name === "create_slate"));

    // 2. Site down: incident board, alert, handoff, agent runs and phones the owner.
    site.status = broken ? "broken" : 500;
    const running = runOnce(slates, telegram, site, dir, extraEnv);
    if (tap) {
      const ask = await waitFor(() => telegram.sent.find((m) => m.reply_markup));
      const button = ask.reply_markup.inline_keyboard[0].find((b) => b.callback_data.endsWith(`:${tap}`));
      telegram.userTaps("555", ask.message_id, button.callback_data);
    }
    r = await running;
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const handoff = slates.calls.find((c) => c.name === "hand_off");
    const taskDir = fs.readdirSync(path.join(dir, "work", "Claude"))[0];
    const work = path.join(dir, "work", "Claude", taskDir);
    const out = {
      handoff,
      decide: fs.readFileSync(path.join(work, "decide-result.txt"), "utf8"),
      followup: fs.existsSync(path.join(work, "followup-approval.txt")) ? fs.readFileSync(path.join(work, "followup-approval.txt"), "utf8") : "",
      prompt: fs.readFileSync(path.join(work, "prompt.txt"), "utf8"),
      args: JSON.parse(fs.readFileSync(path.join(work, "fake-claude-args.json"), "utf8")),
      downStdout: r.stdout,
    };

    // 3. Site back: recovery recorded.
    site.status = 200;
    r = await runOnce(slates, telegram, site, dir, extraEnv);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    return { ...out, slates, telegram, upStdout: r.stdout };
  } finally {
    await slates.close();
    await telegram.close();
    await site.close();
  }
}

test("site down → board, alert, agent phones owner, owner says go, recovery recorded", async () => {
  const { handoff, decide, followup, prompt, args, slates, telegram, downStdout, upStdout } = await scenario();
  // The spoken "Go ahead" already approved it: the follow-up approval is automatic, no Telegram buttons.
  assert.match(followup, /^APPROVED/);
  assert.ok(!telegram.sent.some((m) => m.reply_markup), "owner must not be asked twice");

  // Incident board opened by the watcher, pinned, first row from the Watcher.
  const create = slates.calls.find((c) => c.name === "create_slate" && c.args.slug !== "agents-at-work");
  assert.equal(create.args.kind, "table");
  assert.match(create.args.title, /Incident: demo down/);
  assert.equal(create.args.data.rows[0].cells.who, "Watcher");
  assert.match(create.args.data.rows[0].cells.what, /HTTP 500/);

  // Handoff fits Slates' 400-char limit and carries the marker.
  assert.ok(handoff.args.context.length <= 400 && handoff.args.task.length <= 400);
  assert.match(handoff.args.context, /\[incident:demo\|incident-demo-\d+\|gajanansr\/slates-oncall-demo\]/);

  // The agent got the playbook and gh/git rights only because it's an incident.
  assert.match(prompt, /only fix is|reverting the bad commit/);
  assert.match(prompt, /ask_owner_by_call/);
  assert.match(prompt, /gajanansr\/slates-oncall-demo/);
  const allowed = args.slice(args.indexOf("--allowedTools") + 1).join(" ");
  assert.match(allowed, /Bash\(gh:\*\)/);
  assert.match(allowed, /mcp__calls__ask_owner_by_call/);

  // Owner was alerted, then answered on the (simulated) call.
  assert.ok(telegram.sent.some((m) => /🚨 Slates: demo is down \(HTTP 500\)/.test(m.text)));
  assert.match(decide, /^Owner's choice: Go ahead\nHow: voice call \(completed\)/);
  assert.match(downStdout, /☎️  decision: Go ahead/);
  const note = slates.calls.find((c) => c.name === "add_note" && c.args.id.startsWith("decision-"));
  assert.match(note.args.body, /Decision: Go ahead/);

  // Recovery: board row + Telegram.
  assert.match(upStdout, /✅ demo is back UP/);
  const up = slates.calls.filter((c) => c.name === "patch_items" && c.args.slug !== "agents-at-work").pop();
  assert.match(up.args.upsert[0].cells.what, /Back up \(HTTP 200\)/);
  assert.ok(telegram.sent.some((m) => /✅ Slates: demo is back up/.test(m.text)));
});

test("page still 200 but the expected text is gone → treated as down", async () => {
  const { slates } = await scenario({ extraEnv: {}, broken: true });
  const create = slates.calls.find((c) => c.name === "create_slate" && c.args.slug !== "agents-at-work");
  assert.match(create.args.data.rows[0].cells.what, /no longer says "All systems running"/);
});

test("owner misses the call → Telegram buttons; No means Wait and nothing is fixed", async () => {
  const { decide } = await scenario({ tap: "no", extraEnv: { CALL_SIM_CHOICES: JSON.stringify({ Gajanan: null }) } });
  assert.match(decide, /^Owner's choice: Wait\nHow: Telegram buttons \(no\) after the call was no_answer/);
});
