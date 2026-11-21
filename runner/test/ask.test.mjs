import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  signAskCtx, verifyAskCtx, createAskHandler, agoraSpeaker, cleanTerminalOutput, parseAgyOutput, spokenAnswer,
  askPrompt, codexAskCommand, agyAskCommand, claudeAskCommand, agyMcpConfig, detectAskAgents, createAgentRunner, looksSignedOut,
} from "../ask.mjs";

const SECRET = "test-secret-123";
const nowSec = () => Math.floor(Date.now() / 1000);
const ctxFor = (cast = { Claude: { agentId: "agent-claude-1", uid: 2101 } }, exp = nowSec() + 600) => signAskCtx({ channel: "call-abc", cast, exp }, SECRET);

test("ctx: sign/verify round trip, exact format", () => {
  const payload = { channel: "call-abc", cast: { Codex: { agentId: "a1", uid: 2002 } }, exp: nowSec() + 60 };
  const tok = signAskCtx(payload, SECRET);
  const [body, sig] = tok.split(".");
  assert.equal(Buffer.from(body, "base64url").toString(), JSON.stringify(payload));
  assert.equal(sig, crypto.createHmac("sha256", SECRET).update(body).digest("base64url"));
  assert.deepEqual(verifyAskCtx(tok, SECRET), payload);
});

test("ctx: tampered, wrong secret, expired, malformed are rejected", () => {
  const tok = ctxFor();
  const [body, sig] = tok.split(".");
  const evil = Buffer.from(JSON.stringify({ channel: "other", cast: {}, exp: nowSec() + 600 })).toString("base64url");
  assert.equal(verifyAskCtx(`${evil}.${sig}`, SECRET), null);
  assert.equal(verifyAskCtx(`${body}.${sig.slice(0, -2)}AA`, SECRET), null);
  assert.equal(verifyAskCtx(tok, "other-secret"), null);
  assert.equal(verifyAskCtx(ctxFor(undefined, nowSec() - 1), SECRET), null);
  for (const bad of ["", null, undefined, "abc", "a.b.c", ".", 42]) assert.equal(verifyAskCtx(bad, SECRET), null);
});

test("agy output cleaning strips ^D, backspaces, ANSI and CR; parses json", () => {
  const raw = "^D\b\b\x1b[?25l\x1b[32mHello\x1b[0m there.\r\n\x1b]0;title\x07";
  assert.equal(cleanTerminalOutput(raw), "Hello there.");
  const json = `^D\b\b{"conversation_id":"c","status":"SUCCESS","response":"Your desk has one handoff.\\n","duration_seconds":2}\r`;
  assert.deepEqual(parseAgyOutput(json), { ok: true, text: "Your desk has one handoff." });
  assert.deepEqual(parseAgyOutput("^D\x1b[1mPlain answer\x1b[0m\r\n"), { ok: true, text: "Plain answer" });
  assert.equal(parseAgyOutput('{"status":"ERROR","response":""}').ok, false);
});

test("spokenAnswer drops markdown and caps at 600 chars", () => {
  assert.equal(spokenAnswer("## Desk\n- **one** handoff\n- `two` notes"), "Desk one handoff two notes");
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const s = spokenAnswer(long);
  assert.ok(s.length <= 600);
  assert.ok(s.endsWith("."));
});

test("prompt carries the rules", () => {
  const p = askPrompt({ agent: "Codex", question: "What's due?", ownerName: "Gajanan" });
  assert.match(p, /Gajanan, the owner, is asking you this live on a voice call/);
  assert.match(p, /at most 3 short spoken sentences/);
  assert.match(p, /Do not change anything unless the question explicitly asks you to/);
  assert.match(p, /What's due\?/);
});

test("command lines: read-only tools, token never on the command line", () => {
  const c = claudeAskCommand({ prompt: "q", mcpFile: "/tmp/x.json" });
  assert.equal(c.bin, "claude");
  assert.ok(c.args.includes("mcp__slates__check_desk"));
  assert.ok(!c.args.some((a) => a.includes("mcp__slates__*")));
  assert.equal(c.args[c.args.indexOf("--output-format") + 1], "json");
  const x = codexAskCommand({ prompt: "q", slatesUrl: "https://s/mcp", lastFile: "/tmp/a.txt" });
  assert.equal(x.args[0], "exec");
  assert.ok(x.args.includes("read-only") && x.args.includes("--skip-git-repo-check"));
  assert.ok(x.args.includes('mcp_servers.slates.bearer_token_env_var="SLATES_TOKEN"'));
  assert.equal(x.args[x.args.indexOf("-m") + 1], "gpt-6-luna");
  assert.equal(x.args.at(-1), "q");
  assert.ok(x.args.includes('model_reasoning_effort="low"') && x.args.includes("apps"));
  assert.equal(c.args[c.args.indexOf("--model") + 1], "claude-haiku-5-5");
  assert.deepEqual(agyAskCommand({ bin: "agy", prompt: "q", platform: "darwin" }), { bin: "script", args: ["-q", "/dev/null", "agy", "-p", "q", "--output-format", "json", "--model", "gemini-3.8-flash-low"] });
  assert.equal(agyAskCommand({ bin: "agy", prompt: "it's", model: "", platform: "linux" }).args[1], `'agy' '-p' 'it'\\''s' '--output-format' 'json'`);
  assert.deepEqual(agyMcpConfig({ slatesUrl: "u", token: "t" }).mcpServers.slates.headers, { Authorization: "Bearer t" });
  assert.ok(looksSignedOut("Error: Not logged in. Run codex login"));
  assert.ok(!looksSignedOut("tokens used 14,019"));
});

test("detectAskAgents: Claude always, Codex only when signed in, Antigravity if agy exists", () => {
  const run = (status, out) => () => ({ status, stdout: out, stderr: "" });
  assert.deepEqual(detectAskAgents({}, { bins: { codex: null, agy: null }, run: run(0, "") }), ["Claude"]);
  assert.deepEqual(detectAskAgents({}, { bins: { codex: "/c", agy: "/a" }, run: run(0, "Logged in using ChatGPT") }), ["Claude", "Codex", "Antigravity"]);
  assert.deepEqual(detectAskAgents({}, { bins: { codex: "/c", agy: null }, run: run(1, "Not logged in") }), ["Claude"]);
});

// ---------- handler ----------

function serve(handler) {
  const server = http.createServer(async (req, res) => { if (!(await handler.handle(req, res))) res.writeHead(404).end(); });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
const post = (url, body, auth = `Bearer ${SECRET}`) => fetch(`${url}/ask`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("/ask: wrong or missing bearer → 401 JSON; bad JSON → 400 JSON", async () => {
  const h = createAskHandler({ secret: SECRET, runAgent: async () => ({ ok: true, text: "x" }) });
  const { server, url } = await serve(h);
  try {
    for (const auth of [null, "Bearer nope", `Bearer ${SECRET}x`]) {
      const r = await post(url, { agent: "Claude", question: "hi" }, auth);
      assert.equal(r.status, 401);
      assert.equal((await r.json()).ok, false);
    }
    const bad = await post(url, "{not json");
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).ok, false);
  } finally { server.close(); }
});

test("/ask with cast ctx: runs the agent and speaks with that agent's id and uid", async () => {
  const spoke = [];
  const ran = [];
  const h = createAskHandler({
    secret: SECRET, ownerName: "Gajanan",
    runAgent: async (agent, prompt) => { ran.push({ agent, prompt }); return { ok: true, text: "**Your desk** has two handoffs." }; },
    speak: async (s) => { spoke.push(s); return true; },
  });
  const { server, url } = await serve(h);
  try {
    const r = await post(url, { agent: "Claude", question: "What's on my desk?", ctx: ctxFor(), tool_call_id: "t1" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, agent: "Claude", answer: "Your desk has two handoffs.", spoken: true });
    assert.equal(ran[0].agent, "Claude");
    assert.match(ran[0].prompt, /What's on my desk\?/);
    assert.deepEqual(spoke, [{ channel: "call-abc", agentId: "agent-claude-1", uid: 2101, text: "Your desk has two handoffs." }]);
  } finally { server.close(); }
});

test("ask: no ctx, invalid ctx, or agent not in cast → answered but not spoken", async () => {
  let speaks = 0;
  const h = createAskHandler({ secret: SECRET, runAgent: async () => ({ ok: true, text: "Fine." }), speak: async () => { speaks++; return true; } });
  assert.deepEqual(await h.ask({ agent: "Codex", question: "q" }), { ok: true, agent: "Codex", answer: "Fine.", spoken: false });
  assert.equal((await h.ask({ agent: "Claude", question: "q", ctx: ctxFor() + "x" })).spoken, false);
  assert.equal((await h.ask({ agent: "Codex", question: "q", ctx: ctxFor() })).spoken, false);
  assert.equal(speaks, 0);
});

test("ask: speak failure → spoken false; unknown/unavailable agent → ok false", async () => {
  const h = createAskHandler({ secret: SECRET, available: ["Claude"], runAgent: async () => ({ ok: true, text: "Hi." }), speak: async () => false });
  assert.equal((await h.ask({ agent: "Claude", question: "q", ctx: ctxFor() })).spoken, false);
  assert.equal((await h.ask({ agent: "Gemini", question: "q" })).ok, false);
  const r = await h.ask({ agent: "Codex", question: "q" });
  assert.equal(r.ok, false);
  assert.match(r.answer, /isn't set up/);
});

test("ask: timeout → ok false 'still thinking', and the run is aborted", async () => {
  let aborted = false;
  const h = createAskHandler({
    secret: SECRET, timeoutMs: 5050, deadlineMs: 10_000,
    runAgent: (agent, prompt, { signal }) => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); }),
  });
  const r = await h.ask({ agent: "Antigravity", question: "q", ctx: ctxFor() });
  assert.deepEqual(r, { ok: false, agent: "Antigravity", answer: "Antigravity is still thinking; I'll put the answer on your desk." });
  assert.equal(aborted, true);
});

test("ask: signed-out and failed runs map to short apologies", async () => {
  const h = createAskHandler({ secret: SECRET, runAgent: async (a) => (a === "Codex" ? { ok: false, error: "signed_out" } : { ok: false, error: "failed" }) });
  assert.equal((await h.ask({ agent: "Codex", question: "q" })).answer, "Codex isn't signed in on this laptop yet.");
  assert.equal((await h.ask({ agent: "Claude", question: "q" })).ok, false);
  const thrown = createAskHandler({ secret: SECRET, runAgent: async () => { throw new Error("boom"); } });
  assert.equal((await thrown.ask({ agent: "Claude", question: "q" })).ok, false);
});

test("ask: one in flight per agent, at most 2 overall", async () => {
  let active = 0, peak = 0;
  const perAgent = {};
  let agentOverlap = false;
  const h = createAskHandler({
    secret: SECRET,
    runAgent: async (agent) => {
      active++; peak = Math.max(peak, active);
      if (perAgent[agent]) agentOverlap = true;
      perAgent[agent] = true;
      await new Promise((r) => setTimeout(r, 40));
      perAgent[agent] = false; active--;
      return { ok: true, text: agent };
    },
  });
  const rs = await Promise.all(["Claude", "Claude", "Codex", "Antigravity", "Codex"].map((agent) => h.ask({ agent, question: "q" })));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(peak, 2);
  assert.equal(agentOverlap, false);
});

test("agoraSpeaker posts to the agent's speak URL with a ConvoAI token and INTERRUPT body", async () => {
  const calls = [];
  const env = { AGORA_APP_ID: "0123456789abcdef0123456789abcdef", AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210" };
  const fetchImpl = async (u, init) => { calls.push({ u, init }); return { status: 200, text: async () => "{}" }; };
  assert.equal(await agoraSpeaker(env, { fetchImpl })({ channel: "call-abc", agentId: "ag1", uid: 2101, text: "Hello." }), true);
  assert.equal(calls[0].u, `https://api.agora.io/api/conversational-ai-agent/v2/projects/${env.AGORA_APP_ID}/agents/ag1/speak`);
  assert.match(calls[0].init.headers.authorization, /^agora token="007.+"$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: "Hello.", priority: "INTERRUPT", interruptable: true });
  const fail = agoraSpeaker(env, { fetchImpl: async () => ({ status: 403, text: async () => "no" }) });
  assert.equal(await fail({ channel: "c", agentId: "a", uid: 1, text: "x" }), false);
  assert.equal(await agoraSpeaker({}, { fetchImpl })({ channel: "c", agentId: "a", uid: 1, text: "x" }), false);
});

test("createAgentRunner: writes 0600 configs, parses each agent, cleans up the temp dir", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ask-test-"));
  const seen = [];
  const run = async (bin, args, { cwd }) => {
    const entry = { bin, args, cwd, files: {} };
    if (bin === "claude") {
      const f = args[args.indexOf("--mcp-config") + 1];
      entry.mode = fs.statSync(f).mode & 0o777;
      seen.push(entry);
      return { code: 0, stdout: JSON.stringify({ result: "Claude says hi.", is_error: false }), stderr: "" };
    }
    if (bin === "/bin/codex") {
      fs.writeFileSync(args[args.indexOf("-o") + 1], "Codex says hi.\n");
      seen.push(entry);
      return { code: 0, stdout: "tokens used\n100\nCodex says hi.", stderr: "" };
    }
    const cfgFile = path.join(cwd, ".agents", "mcp_config.json");
    entry.mode = fs.statSync(cfgFile).mode & 0o777;
    entry.cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    seen.push(entry);
    return { code: 0, stdout: '^D\b\b{"status":"SUCCESS","response":"Agy says hi."}\r', stderr: "" };
  };
  const runner = createAgentRunner({}, { slatesUrl: "https://s/mcp", token: "tok", bins: { claude: "claude", codex: "/bin/codex", agy: "/bin/agy" }, tmpRoot, run });
  assert.deepEqual(await runner("Claude", "p"), { ok: true, text: "Claude says hi." });
  assert.deepEqual(await runner("Codex", "p"), { ok: true, text: "Codex says hi." });
  assert.deepEqual(await runner("Antigravity", "p"), { ok: true, text: "Agy says hi." });
  assert.equal(seen[0].mode, 0o600);
  assert.equal(seen[2].mode, 0o600);
  assert.equal(seen[2].cfg.mcpServers.slates.serverUrl, "https://s/mcp");
  assert.deepEqual(fs.readdirSync(tmpRoot), []); // all temp dirs (and tokens) removed
  const signedOut = createAgentRunner({}, { slatesUrl: "u", token: "t", bins: { codex: "/bin/codex" }, tmpRoot, run: async () => ({ code: 1, stdout: "", stderr: "Error: Not logged in" }) });
  assert.equal((await signedOut("Codex", "p")).error, "signed_out");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
