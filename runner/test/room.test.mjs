import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { signAskCtx, createAskHandler, agoraInterrupter, askPrompt } from "../ask.mjs";
import {
  createRooms, newRoom, addLine, takeFloor, hush, speakersToInterrupt, floorOf, jumpInCandidates, transcriptTail,
  roomState, diffHistory, applyEvent, parseModeratorDecision, decideJumpIn, moderatorPrompt, jumpInPrompt, isPass,
  geminiModerator, setThinking, statusOf, ROOM_IDLE_MS, HUMAN_FLOOR_MS,
} from "../room.mjs";

const SECRET = "room-secret-1";
const nowSec = () => Math.floor(Date.now() / 1000);
const CAST = { Claude: { agentId: "ag-claude", uid: 2001 }, Codex: { agentId: "ag-codex", uid: 2002 }, Antigravity: { agentId: "ag-anti", uid: 2003 } };
const ctxFor = (channel = "call-room", cast = CAST) => signAskCtx({ channel, cast, exp: nowSec() + 600 }, SECRET);
const roomWith = (cast = CAST) => Object.assign(newRoom("c"), { cast });

// ---------- pure floor logic ----------

test("floor: the current speaker is interrupted before a newcomer speaks, with a note for its next prompt", () => {
  const r = roomWith();
  const t = 1_000_000;
  takeFloor(r, "Claude", "The deploy failed because the env var is missing.", { now: t });
  assert.equal(statusOf(r, "Claude", t + 100), "speaking");
  assert.deepEqual(speakersToInterrupt(r, "Codex", t + 100), ["Claude"]);
  assert.deepEqual(speakersToInterrupt(r, "Claude", t + 100), []); // never yourself
  takeFloor(r, "Codex", "I disagree, it was the build cache.", { interrupted: ["Claude"], now: t + 200 });
  assert.equal(statusOf(r, "Claude", t + 300), "idle");
  assert.equal(floorOf(r, t + 300).who, "Codex");
  assert.deepEqual(r.transcript.map((l) => l.text).slice(-2), ["[Claude was interrupted by Codex]", "I disagree, it was the build cache."]);
  assert.match(transcriptTail(r), /\[Claude was interrupted by Codex\]\nCodex: I disagree/);
  // Speech ends on its own: then nobody holds the floor.
  assert.equal(floorOf(r, t + 60_000), null);
});

test("hush: the owner interrupts every speaking agent, takes the floor, and resets the agent run", () => {
  const r = roomWith();
  const t = 5_000_000;
  takeFloor(r, "Claude", "one two three four five six", { now: t });
  takeFloor(r, "Codex", "seven eight nine", { now: t + 10 }); // overlapping (no interrupt passed): both speaking
  assert.equal(r.agentRun, 2);
  const names = hush(r, { uids: [2003], ownerLabel: "Gajanan", now: t + 20 });
  assert.deepEqual(names.sort(), ["Antigravity", "Claude", "Codex"]); // 2003 heard by the page
  assert.ok(["Claude", "Codex"].every((n) => statusOf(r, n, t + 30) === "idle"));
  assert.equal(floorOf(r, t + 30).who, "human");
  assert.equal(r.agentRun, 0);
  assert.ok(r.transcript.some((l) => l.text === "[Claude was interrupted by Gajanan]"));
  // Their words arrive: the floor opens. A lost utterance frees it after HUMAN_FLOOR_MS.
  addLine(r, { kind: "human", who: "You", text: "Stop, what about tests?" }, t + 2000);
  assert.equal(floorOf(r, t + 2001), null);
  hush(r, { now: t + 3000 });
  assert.equal(floorOf(r, t + 3000 + HUMAN_FLOOR_MS + 1), null);
});

test("jump-in rules: never the last agent, max 2 agent turns in a row, not while thinking or the owner holds the floor", () => {
  const r = roomWith();
  const live = ["Claude", "Codex", "Antigravity"];
  addLine(r, { kind: "human", who: "You", text: "Claude, why did it fail?" }, 1);
  addLine(r, { kind: "agent", who: "Claude", text: "Missing env var." }, 2);
  assert.deepEqual(jumpInCandidates(r, live, 3), ["Codex", "Antigravity"]);
  setThinking(r, "Antigravity", true);
  assert.deepEqual(jumpInCandidates(r, live, 3), []);
  setThinking(r, "Antigravity", false);
  addLine(r, { kind: "agent", who: "Codex", text: "Also the cache." }, 4);
  assert.deepEqual(jumpInCandidates(r, live, 5), []); // two agent turns in a row: back to the owner
  addLine(r, { kind: "human", who: "You", text: "Ok." }, 6);
  assert.deepEqual(jumpInCandidates(r, live, 7), ["Claude", "Antigravity"]); // Codex spoke last
  hush(r, { now: 8 });
  assert.deepEqual(jumpInCandidates(r, live, 9), []);
  r.floor = null;
  r.jumping = true;
  assert.deepEqual(jumpInCandidates(r, live, 9), []);
});

test("history sync: only new lines are appended as the caption window slides", () => {
  const A = { who: "Slates", text: "Hi, it's Slates." };
  const B = { who: "You", text: "Claude, status?" };
  const C = { who: "Slates", text: "Asking Claude" };
  const D = { who: "You", text: "Thanks" };
  assert.deepEqual(diffHistory([], [A, B]), [A, B]);
  assert.deepEqual(diffHistory([A, B], [A, B, C]), [C]);
  assert.deepEqual(diffHistory([A, B, C], [B, C, D]), [D]); // window dropped A
  assert.deepEqual(diffHistory([A, B], [A, B]), []);
  const r = roomWith();
  assert.equal(applyEvent(r, { history: [A, B], host: { agentId: "host-1" } }, 1).length, 2);
  assert.equal(applyEvent(r, { history: [A, B, C] }, 2).length, 1);
  assert.equal(applyEvent(r, { lines: [{ who: "Claude", text: "forged agent line" }] }, 3).length, 0); // agents speak only via the runner
  assert.equal(r.host.agentId, "host-1");
  assert.deepEqual(roomState(r, 4).transcript.map((l) => l.who), ["Slates", "You", "Slates"]);
});

test("rooms expire after 2 h idle", () => {
  let t = 0;
  const rooms = createRooms({ now: () => t });
  rooms.get("a", CAST);
  t = ROOM_IDLE_MS - 1;
  rooms.get("b");
  assert.equal(rooms.size, 2);
  t = ROOM_IDLE_MS + 10;
  rooms.sweep();
  assert.equal(rooms.peek("a"), null);
  assert.ok(rooms.peek("b"));
});

// ---------- moderator ----------

test("moderator decision parsing: JSON, bare names, none, and unknown names", () => {
  const c = ["Codex", "Antigravity"];
  assert.equal(parseModeratorDecision('{"agent":"Codex"}', c), "Codex");
  assert.equal(parseModeratorDecision('```json\n{"agent": "antigravity"}\n```', c), "Antigravity");
  assert.equal(parseModeratorDecision('{"agent": null}', c), null);
  assert.equal(parseModeratorDecision("Codex.", c), "Codex");
  assert.equal(parseModeratorDecision('{"agent":"Claude"}', c), null); // not a candidate (spoke last)
  assert.equal(parseModeratorDecision("none", c), null);
  assert.equal(parseModeratorDecision("", c), null);
  const p = moderatorPrompt({ tail: "Claude: x", last: "Claude", candidates: c });
  assert.match(p, /Claude just finished speaking/);
  assert.match(p, /- Codex: OpenAI's Codex CLI/);
});

test("decideJumpIn: times out to null (and aborts), errors to null", async () => {
  let aborted = false;
  const slow = (prompt, signal) => new Promise((r) => { signal.addEventListener("abort", () => { aborted = true; r('{"agent":"Codex"}'); }); });
  const t0 = Date.now();
  assert.equal(await decideJumpIn({ moderate: slow, tail: "", last: "Claude", candidates: ["Codex"], timeoutMs: 50 }), null);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(aborted, true);
  assert.equal(await decideJumpIn({ moderate: async () => { throw new Error("x"); }, tail: "", last: "Claude", candidates: ["Codex"] }), null);
  assert.equal(await decideJumpIn({ moderate: null, tail: "", last: "Claude", candidates: ["Codex"] }), null);
  assert.equal(await decideJumpIn({ moderate: async () => '{"agent":"Codex"}', tail: "", last: "Claude", candidates: ["Codex"] }), "Codex");
});

test("geminiModerator: REST call shape; no key → null", async () => {
  assert.equal(geminiModerator({}), null);
  const calls = [];
  const m = geminiModerator({ GEMINI_API_KEY: "k" }, { fetchImpl: async (u, init) => { calls.push({ u, init }); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"agent":"Codex"}' }] } }] }) }; } });
  assert.equal(await m("prompt"), '{"agent":"Codex"}');
  assert.match(calls[0].u, /models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "k");
  const bad = geminiModerator({ GEMINI_API_KEY: "k" }, { fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(await bad("p"), null);
});

test("prompts: the ask carries the meeting tail and name; the jump-in asks for PASS", () => {
  const p = askPrompt({ agent: "Codex", question: "Thoughts?", ownerName: "Gajanan", transcript: "Gajanan: why?\nClaude: env var." });
  assert.match(p, /Here is the meeting so far/);
  assert.match(p, /Claude: env var\./);
  assert.match(p, /You are Codex\. Reply to the question; you may agree or disagree with the others by name/);
  assert.doesNotMatch(askPrompt({ agent: "Codex", question: "q" }), /meeting so far/);
  const j = jumpInPrompt({ agent: "Codex", last: "Claude", ownerName: "Gajanan", tail: "Claude: env var." });
  assert.match(j, /Jump in briefly if you have something useful to add to Claude's point/);
  assert.match(j, /reply with exactly: PASS/);
  assert.ok(isPass("PASS") && isPass(" pass. ") && isPass("**PASS**"));
  assert.ok(!isPass("I'd pass on that, but the cache is stale."));
});

// ---------- the handler: asks, floor, jump-ins ----------

function fakeHandler({ answers = {}, moderate = null, ...rest } = {}) {
  const spoke = [];
  const interrupted = [];
  const prompts = [];
  const h = createAskHandler({
    secret: SECRET, ownerName: "Gajanan", humanWaitMs: 0, moderatorTimeoutMs: 500,
    runAgent: async (agent, prompt) => {
      prompts.push({ agent, prompt });
      const a = answers[agent];
      const text = typeof a === "function" ? a(prompt) : a ?? `${agent} answer.`;
      return { ok: true, text };
    },
    speak: async (s) => { spoke.push(s); return true; },
    interrupt: async (s) => { interrupted.push(s); return true; },
    moderate,
    ...rest,
  });
  return { h, spoke, interrupted, prompts };
}

test("ask: the prompt has the meeting so far; the answer joins the transcript; the next agent interrupts the speaker", async () => {
  const { h, spoke, interrupted, prompts } = fakeHandler();
  const ctx = ctxFor("call-1");
  const room = h.rooms.get("call-1", CAST);
  addLine(room, { kind: "human", who: "You", text: "Claude, why did the deploy fail?" });
  await h.ask({ agent: "Claude", question: "Why did the deploy fail?", ctx });
  assert.match(prompts[0].prompt, /Gajanan: Claude, why did the deploy fail\?/);
  assert.equal(spoke[0].agentId, "ag-claude");
  // Claude is still talking (estimated) when Codex is asked: Claude is interrupted first, and Codex hears that.
  await h.ask({ agent: "Codex", question: "Do you agree?", ctx });
  assert.deepEqual(interrupted.map((i) => i.agentId), ["ag-claude"]);
  assert.match(prompts[1].prompt, /Claude: Claude answer\./);
  assert.deepEqual(room.transcript.map((l) => l.text).slice(-3), ["Claude answer.", "[Claude was interrupted by Codex]", "Codex answer."]);
  await h.idle();
});

test("jump-in: the moderator picks one other agent; it speaks; then the room yields (max 2 agent turns, no repeats)", async () => {
  const decided = [];
  const moderate = async (prompt) => {
    decided.push(prompt);
    return prompt.includes("- Codex") ? '{"agent":"Codex"}' : '{"agent":"Antigravity"}';
  };
  const { h, spoke, prompts } = fakeHandler({ moderate, answers: { Codex: "I disagree with Claude: it was the cache." } });
  const ctx = ctxFor("call-2");
  const room = h.rooms.get("call-2", CAST);
  addLine(room, { kind: "human", who: "You", text: "Why did it fail?" });
  room.speakingUntil = {};
  await h.ask({ agent: "Claude", question: "Why did it fail?", ctx });
  await h.idle();
  assert.deepEqual(spoke.map((s) => s.agentId), ["ag-claude", "ag-codex"]);
  assert.match(prompts[1].prompt, /Jump in briefly if you have something useful to add to Claude's point/);
  assert.equal(room.agentRun, 2);
  assert.equal(decided.length, 1); // after Codex: two agent turns in a row, so no third moderator call
  assert.ok(!decided[0].includes("- Claude:")); // Claude spoke last: not a candidate
});

test("jump-in: PASS → nothing spoken or added; owner speaking meanwhile → dropped", async () => {
  const { h, spoke } = fakeHandler({ moderate: async () => '{"agent":"Codex"}', answers: { Codex: "PASS" } });
  const ctx = ctxFor("call-3");
  await h.ask({ agent: "Claude", question: "q", ctx });
  await h.idle();
  assert.deepEqual(spoke.map((s) => s.agentId), ["ag-claude"]);
  assert.ok(!h.rooms.peek("call-3").transcript.some((l) => l.who === "Codex"));

  let room;
  const late = fakeHandler({
    moderate: async () => '{"agent":"Codex"}',
    answers: { Codex: () => { addLine(room, { kind: "human", who: "You", text: "Wait, new topic." }); return "Adding to Claude: cache."; } },
  });
  room = late.h.rooms.get("call-4", CAST);
  await late.h.ask({ agent: "Claude", question: "q", ctx: ctxFor("call-4") });
  await late.h.idle();
  assert.deepEqual(late.spoke.map((s) => s.agentId), ["ag-claude"]);
});

test("jump-in after a host turn via /room/event; 'Asking …' lines and greetings do not trigger it", async () => {
  const decided = [];
  const { h, spoke } = fakeHandler({ moderate: async (p) => { decided.push(p); return '{"agent":"Antigravity"}'; } });
  const { server, url } = await serve(h);
  try {
    const ctx = ctxFor("call-5");
    const ev = (body) => fetch(`${url}/room/event`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify({ ctx, ...body }) }).then((r) => r.json());
    await ev({ history: [{ who: "Slates", text: "Hi Gajanan, it's Slates." }] });
    await h.idle();
    assert.equal(decided.length, 0); // greeting, nobody has spoken yet
    await ev({ history: [{ who: "Slates", text: "Hi Gajanan, it's Slates." }, { who: "You", text: "What's due today?" }, { who: "Slates", text: "Asking Claude" }] });
    await h.idle();
    assert.equal(decided.length, 0);
    const r = await ev({ history: [{ who: "You", text: "What's due today?" }, { who: "Slates", text: "Asking Claude" }, { who: "Slates", text: "Two invoices are due today." }] });
    assert.equal(r.added, 1);
    await h.idle();
    // One jump-in after Slates; the moderator is asked once more after it, but Antigravity can't go twice in a row.
    assert.equal(decided.length, 2);
    assert.ok(!decided[1].includes("- Antigravity:"));
    assert.deepEqual(spoke.map((s) => s.agentId), ["ag-anti"]);
  } finally { server.close(); }
});

// ---------- HTTP: auth, hush, state ----------

function serve(handler) {
  const server = http.createServer(async (req, res) => { if (!(await handler.handle(req, res))) res.writeHead(404).end(); });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

test("/room/*: 401 without the bearer or with a bad ctx; 405 on the wrong method", async () => {
  const { h } = fakeHandler();
  const { server, url } = await serve(h);
  try {
    const ctx = ctxFor();
    const post = (p, body, auth = `Bearer ${SECRET}`) => fetch(`${url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
    for (const auth of [null, "Bearer nope"]) {
      assert.equal((await post("/room/event", { ctx, lines: [] }, auth)).status, 401);
      assert.equal((await post("/room/hush", { ctx }, auth)).status, 401);
      assert.equal((await fetch(`${url}/room/state?ctx=${encodeURIComponent(ctx)}`, { headers: auth ? { authorization: auth } : {} })).status, 401);
    }
    assert.equal((await post("/room/hush", { ctx: ctx + "x" })).status, 401);
    assert.equal((await post("/room/event", { ctx: signAskCtx({ channel: "c", cast: {}, exp: nowSec() - 5 }, SECRET) })).status, 401);
    assert.equal((await fetch(`${url}/room/state`, { headers: { authorization: `Bearer ${SECRET}` } })).status, 401);
    assert.equal((await fetch(`${url}/room/hush?ctx=${ctx}`, { headers: { authorization: `Bearer ${SECRET}` } })).status, 405);
    assert.equal((await post("/room/nope", { ctx })).status, 404);
    const ok = await fetch(`${url}/room/state?ctx=${encodeURIComponent(ctx)}`, { headers: { authorization: `Bearer ${SECRET}` } });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).state.status, { Claude: "idle", Codex: "idle", Antigravity: "idle" });
  } finally { server.close(); }
});

test("/room/hush interrupts the speaking agent through Agora and the state shows the owner's floor", async () => {
  const { h, interrupted } = fakeHandler();
  const { server, url } = await serve(h);
  try {
    const ctx = ctxFor("call-6");
    await h.ask({ agent: "Claude", question: "Long answer please", ctx });
    const r = await fetch(`${url}/room/hush`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ ctx }) });
    const j = await r.json();
    assert.deepEqual(j.interrupted, ["Claude"]);
    assert.deepEqual(interrupted, [{ channel: "call-6", agentId: "ag-claude", uid: 2001 }]);
    assert.deepEqual(j.state.floor.who, "You");
    assert.equal(j.state.status.Claude, "idle");
    assert.ok(j.state.transcript.some((l) => l.text === "[Claude was interrupted by Gajanan]"));
  } finally { server.close(); }
});

test("agoraInterrupter posts to /interrupt with the agent's ConvoAI token", async () => {
  const calls = [];
  const env = { AGORA_APP_ID: "0123456789abcdef0123456789abcdef", AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210" };
  const fetchImpl = async (u, init) => { calls.push({ u, init }); return { status: 200, text: async () => "" }; };
  assert.equal(await agoraInterrupter(env, { fetchImpl })({ channel: "c", agentId: "ag1", uid: 2001 }), true);
  assert.equal(calls[0].u, `https://api.agora.io/api/conversational-ai-agent/v2/projects/${env.AGORA_APP_ID}/agents/ag1/interrupt`);
  assert.match(calls[0].init.headers.authorization, /^agora token="007.+"$/);
  assert.equal(await agoraInterrupter({}, { fetchImpl })({ channel: "c", agentId: "a", uid: 1 }), false);
});
