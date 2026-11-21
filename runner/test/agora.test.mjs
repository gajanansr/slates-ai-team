import { test } from "node:test";
import assert from "node:assert/strict";
import { agoraProvider, agoraMissing, joinBody, castBody, pickChoice, isGoodbye, systemPrompt, toTranscript, fitSpeech, mergeCaptions, murfTts } from "../agora.mjs";

const env = {
  AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210",
  MURF_API_KEY: "murf-test",
  PUBLIC_BASE_URL: "https://demo.example/",
  OWNER_NAME: "Gajanan",
  CALL_RING_SEC: "2",
};

test("agoraMissing lists what is not set", () => {
  assert.deepEqual(agoraMissing({}), ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "MURF_API_KEY", "PUBLIC_BASE_URL"]);
  assert.deepEqual(agoraMissing(env), []);
});

test("joinBody uses Murf voice, managed LLM by default, Claude when a key is set", () => {
  const b = joinBody(env, { name: "c1", channel: "c1", agentToken: "tok", system: "sys", greeting: "Hi", maxMinutes: 3 });
  assert.equal(b.properties.tts.vendor, "murf");
  assert.equal(b.properties.tts.params.api_key, "murf-test");
  assert.equal(b.properties.llm.credential_mode, "managed");
  assert.equal(b.properties.llm.greeting_message, "Hi");
  assert.deepEqual(b.properties.remote_rtc_uids, ["1001"]);
  assert.ok(b.properties.parameters.silence_config.timeout_ms <= 60000);
  const c = joinBody({ ...env, ANTHROPIC_API_KEY: "sk" }, { name: "c1", channel: "c1", agentToken: "t", system: "s", greeting: "g" });
  assert.equal(c.properties.llm.style, "anthropic");
  assert.equal(c.properties.llm.params.max_tokens, 300);
});

test("system prompt keeps AI honesty and the options", () => {
  const s = systemPrompt({ ownerName: "Gajanan", name: "Ramesh", goal: "Pick a time", options: ["Sat 8pm", "Sun 1pm"] });
  assert.match(s, /Never pretend to be human/);
  assert.match(s, /Sat 8pm \/ Sun 1pm/);
  assert.match(s, /Goodbye/);
});

test("pickChoice prefers what the agent repeated back, then the person", () => {
  const opts = ["Sat 8pm", "Sun 1pm"];
  assert.equal(pickChoice([{ role: "user", content: "maybe sun 1pm?" }, { role: "assistant", content: "Great, Sun 1pm it is. Goodbye" }], opts), "Sun 1pm");
  // The person's raw words never decide; only the host's confirmation after they spoke does.
  assert.equal(pickChoice([{ role: "assistant", content: "Which works?" }, { role: "user", content: "Sat 8pm please" }], opts), null);
  assert.equal(pickChoice([{ role: "user", content: "Sat 8pm please" }, { role: "assistant", content: "Great, Sat 8pm it is." }], opts), "Sat 8pm");
  assert.equal(pickChoice([{ role: "user", content: "either Sat 8pm or Sun 1pm" }], opts), null);
  // Regression (review finding 1): the host's own question must never count as the answer.
  assert.equal(pickChoice([{ role: "assistant", content: "Should we go ahead and revert it?" }], ["Go ahead", "Wait"]), null);
  assert.equal(pickChoice([{ role: "user", content: "No, do not go ahead yet" }], ["Go ahead", "Wait"]), null);
  assert.equal(isGoodbye([{ role: "assistant", content: "Thanks, goodbye!" }]), true);
  assert.deepEqual(toTranscript([{ role: "assistant", content: "Hi" }, { role: "user", content: "Yo" }], "Ramesh"), [{ speaker: "Agent", text: "Hi" }, { speaker: "Ramesh", text: "Yo" }]);
});

test("missing config fails clearly without calling Agora", async () => {
  const p = agoraProvider({});
  const r = await p.call({ name: "X", goal: "test" });
  assert.equal(r.status, "failed");
  assert.match(r.summary, /missing AGORA_APP_ID/);
});

// A fake Agora REST API + a fake person opening the link.
function fakeAgora(script) {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.authorization });
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (url.endsWith("/join")) return ok({ agent_id: "AG1", status: "RUNNING" });
    if (url.endsWith("/history")) { polls++; return ok({ status: "RUNNING", contents: script.slice(0, Math.min(script.length, polls * 2)) }); }
    if (url.endsWith("/leave")) return { ok: true, status: 200, text: async () => "" };
    if (url.endsWith("/speak")) return ok({});
    return { ok: false, status: 404, text: async () => "nope" };
  };
  return { fetchImpl, calls };
}

async function openLink(p, link) {
  const id = link.match(/\/c\/([a-f0-9]{32})/)[1];
  const res = { code: 0, body: "", writeHead(c) { this.code = c; return this; }, end(b) { this.body = b; } };
  await p.handlePage({ url: `/c/${id}` }, res);
  assert.match(res.body, /agora-rtc-sdk-ng@4\.24\.9/);
  const cfgRes = { ...res, body: "" };
  await p.handlePage({ url: `/c/${id}/config` }, cfgRes);
  const cfg = JSON.parse(cfgRes.body);
  assert.equal(cfg.uid, 1001);
  assert.ok(cfg.token.length > 50);
  await p.handlePage({ url: `/c/${id}/joined` }, { ...res });
}

test("full call: link sent, person joins, agent talks, choice picked, agent stopped", { timeout: 20000 }, async () => {
  const script = [
    { role: "assistant", content: "Hi Ramesh, this is an AI assistant calling on behalf of Gajanan." },
    { role: "user", content: "Sure, go ahead" },
    { role: "assistant", content: "Which works for dinner, Sat 8pm or Sun 1pm?" },
    { role: "user", content: "Sunday works" },
    { role: "assistant", content: "Great, Sun 1pm it is. Thanks, Goodbye!" },
  ];
  const fake = fakeAgora(script);
  const p = agoraProvider(env, { fetchImpl: fake.fetchImpl });
  const sent = [];
  const done = p.call({
    name: "Ramesh", goal: "Pick a dinner time", greeting: "Hi Ramesh", options: ["Sat 8pm", "Sun 1pm"], maxMinutes: 1,
    notify: async (t) => { sent.push(t); setTimeout(() => openLink(p, t), 50); },
  });
  const r = await done;
  assert.equal(sent.length, 1);
  assert.match(sent[0], /https:\/\/demo\.example\/c\/[a-f0-9]{32}/);
  assert.equal(r.status, "completed");
  assert.equal(r.choice, "Sun 1pm");
  assert.equal(r.transcript.length, 5);
  const join = fake.calls.find((c) => c.url.endsWith("/join"));
  assert.match(join.auth, /^agora token="/);
  assert.equal(join.body.properties.llm.greeting_message, "Hi Ramesh");
  assert.ok(fake.calls.some((c) => c.url.endsWith("/agents/AG1/leave")), "agent stopped");
});

test("nobody opens the link → no_answer, Agora never called", { timeout: 10000 }, async () => {
  const fake = fakeAgora([]);
  const p = agoraProvider(env, { fetchImpl: fake.fetchImpl });
  const r = await p.call({ name: "Priya", goal: "Pick", options: ["A", "B"], notify: async () => {} });
  assert.equal(r.status, "no_answer");
  assert.equal(r.choice, null);
  assert.equal(fake.calls.length, 0);
});

test("room pieces: no speaker lock by default (echo fooled it), cast never listens, voices pick their locale, speech fits 512 bytes", () => {
  const h = joinBody(env, { name: "c", channel: "c", agentToken: "t", system: "s", greeting: "g" });
  assert.equal(h.properties.sal, undefined);
  assert.equal(h.properties.turn_detection.config.speech_threshold, 0.6);
  assert.equal(joinBody({ ...env, CALL_SAL: "1" }, { name: "c", channel: "c", agentToken: "t", system: "s", greeting: "g" }).properties.sal.sal_mode, "locking");
  const c = castBody(env, { name: "c-2001", channel: "c", token: "t", uid: 2001, voice: "en-IN-aarav" });
  assert.deepEqual(c.properties.remote_rtc_uids, ["9999"]);
  assert.equal(c.properties.tts.params.locale, "en-IN");
  assert.equal(murfTts(env).params.voiceId, "en-US-natalie");
  const long = "This is a sentence. ".repeat(60);
  const fit = fitSpeech(long);
  assert.ok(Buffer.byteLength(fit) <= 500 && fit.endsWith("."));
  const caps = mergeCaptions(
    [{ role: "assistant", content: "Hi Gajanan" }, { role: "assistant", content: "I found it" }, { role: "user", content: "Go ahead" }],
    [{ who: "Claude", text: "I found it" }],
    { hostName: "Slates", personName: "Gajanan" },
  );
  assert.deepEqual(caps.map((x) => x.who), ["Slates", "Claude", "Gajanan"]);
});

test("owner room: cast speaks in order, owner taps Go ahead, everyone is stopped", { timeout: 30000 }, async () => {
  const fake = fakeAgora([{ role: "assistant", content: "Hi Gajanan, it's Slates." }]);
  const p = agoraProvider(env, { fetchImpl: fake.fetchImpl });
  let link;
  const done = p.call({
    name: "Gajanan", toOwner: true, goal: "Demo is down", greeting: "Hi", options: ["Go ahead", "Wait"], maxMinutes: 1,
    cast: [{ name: "Claude", says: "I found the bad commit." }, { name: "Gemini", says: "I agree with Claude." }],
    room: { headline: "Demo is down", question: "Should we revert it?" },
    notify: async (t) => { link = t; setTimeout(() => openLink(p, t), 30); },
  });
  const id = await new Promise((r) => { const iv = setInterval(() => { if (link) { clearInterval(iv); r(link.match(/\/c\/([a-f0-9]{32})/)[1]); } }, 20); });
  // Config shows the team; then the owner taps the first option.
  await new Promise((r) => setTimeout(r, 200));
  const res = { body: "", writeHead() { return this; }, end(b) { this.body = b; } };
  await p.handlePage({ url: `/c/${id}/config` }, res);
  assert.deepEqual(JSON.parse(res.body).participants.map((x) => x.name), ["Slates", "Claude", "Gemini"]);
  // The phone reports each voice going quiet (real audio levels); the next voice waits for that.
  const quiet = setInterval(() => ["1000", "2001", "2002"].forEach((uid) => p.handlePage({ url: `/c/${id}/quiet?uid=${uid}` }, { ...res })), 500);
  const said = () => fake.calls.filter((c) => c.url.endsWith("/speak")).map((c) => c.body.text);
  await new Promise((r) => { const iv = setInterval(() => { if (said().includes("Should we revert it?")) { clearInterval(iv); r(); } }, 100); });
  clearInterval(quiet);
  await p.handlePage({ url: `/c/${id}/choose?i=0` }, { ...res });
  const r = await done;
  assert.equal(r.choice, "Go ahead");
  assert.equal(r.status, "completed");
  assert.match(r.summary, /tapped/);
  const joins = fake.calls.filter((c) => c.url.endsWith("/join"));
  assert.equal(joins.length, 3, "host + 2 cast");
  const speaks = fake.calls.filter((c) => c.url.endsWith("/speak")).map((c) => c.body.text);
  assert.deepEqual(speaks.slice(0, 4), ["I found the bad commit.", "Gemini, do you agree?", "I agree with Claude.", "Should we revert it?"], "one voice at a time, with a handover");
  assert.ok(speaks.some((t) => /Okay, Go ahead/.test(t)));
  assert.equal(fake.calls.filter((c) => c.url.endsWith("/leave")).length, 3, "all agents stopped");
  assert.ok(r.transcript.some((l) => l.speaker === "Claude"));
});

test("declining the call returns no_answer right away", { timeout: 10000 }, async () => {
  const fake = fakeAgora([]);
  const p = agoraProvider({ ...env, CALL_RING_SEC: "30" }, { fetchImpl: fake.fetchImpl });
  const r = await p.call({ name: "Gajanan", toOwner: true, goal: "x", options: ["Go ahead", "Wait"], notify: async (t) => {
    const id = t.match(/\/c\/([a-f0-9]{32})/)[1];
    setTimeout(() => p.handlePage({ url: `/c/${id}/decline` }, { writeHead() { return this; }, end() {} }), 30);
  } });
  assert.equal(r.status, "no_answer");
  assert.match(r.summary, /declined/);
  assert.equal(fake.calls.length, 0);
});
