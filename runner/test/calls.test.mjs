import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, isQuietHour, checkCall, disclosureGreeting, callNote, createCallProvider } from "../calls.mjs";

test("normalizePhone needs a country code", () => {
  assert.equal(normalizePhone("+91 98765-43210"), "+919876543210");
  assert.equal(normalizePhone("+1 (415) 555-0100"), "+14155550100");
  assert.equal(normalizePhone("9876543210"), null);
  assert.equal(normalizePhone("+12"), null);
  assert.equal(normalizePhone("+91 98765 abc"), null);
});

test("isQuietHour handles overnight ranges", () => {
  assert.equal(isQuietHour(22, "21-9"), true);
  assert.equal(isQuietHour(3, "21-9"), true);
  assert.equal(isQuietHour(9, "21-9"), false);
  assert.equal(isQuietHour(14, "21-9"), false);
  assert.equal(isQuietHour(14, "0-24"), true);
  assert.equal(isQuietHour(14, ""), false);
  assert.equal(isQuietHour(14, "13-15"), true);
});

test("checkCall: limits and time zone", () => {
  const noon = new Date("2026-11-21T06:30:00Z"); // 12:00 in Kolkata, 01:30 in New York
  assert.deepEqual(checkCall({ phone: "+919876543210", callsSoFar: 0, maxCalls: 3, now: noon, quietHours: "21-9", timeZone: "Asia/Kolkata" }), { ok: true, phone: "+919876543210" });
  assert.match(checkCall({ phone: "+919876543210", callsSoFar: 0, maxCalls: 3, now: noon, quietHours: "21-9", timeZone: "America/New_York" }).reason, /quiet hours/);
  assert.match(checkCall({ phone: "+919876543210", callsSoFar: 3, maxCalls: 3, now: noon, quietHours: "" }).reason, /limit is 3/);
});

test("disclosure is always in the greeting", () => {
  assert.equal(disclosureGreeting("Gajanan", "Ramesh"), "Hi Ramesh, this is an AI assistant calling on behalf of Gajanan. Is now a good time for a quick call?");
  assert.match(disclosureGreeting("Gajanan"), /^Hi, this is an AI assistant/);
});

test("callNote is phone-readable and bounded", () => {
  const n = callNote({ name: "R", phone: "+1", goal: "g", taskId: "h1", agentName: "Claude", at: new Date("2026-11-21T10:00:00Z"),
    result: { status: "completed", durationSec: 90, summary: "ok", transcript: [{ speaker: "Agent", text: "hi" }] } });
  assert.equal(n.title, "Call: R – g");
  assert.match(n.body, /completed · 1\.5 min/);
  assert.match(n.body, /\*\*Agent:\*\* hi/);
});

test("providers: none by default, simulated works, agora refuses clearly until set up", async () => {
  assert.equal(createCallProvider({}), null);
  const sim = createCallProvider({ CALL_PROVIDER: "simulated", CALL_SIM_OUTCOME: "no_answer" });
  assert.equal((await sim.call({})).status, "no_answer");
  const agora = createCallProvider({ CALL_PROVIDER: "agora" });
  const r = await agora.call({});
  assert.equal(r.status, "failed");
  assert.match(r.summary, /missing AGORA_APP_ID, AGORA_APP_CERTIFICATE, MURF_API_KEY, PUBLIC_BASE_URL/);
});
