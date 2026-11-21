import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parseAnswer, decisionTwiml, twilioSignature, validSignature, createTwilio, twilioMissing } from "../twilio.mjs";

const OPTS = ["Go ahead", "Wait"];

test("parseAnswer: keys, exact words, everyday yes/no", () => {
  assert.equal(parseAnswer({ Digits: "1" }, OPTS), "Go ahead");
  assert.equal(parseAnswer({ Digits: "2" }, OPTS), "Wait");
  assert.equal(parseAnswer({ SpeechResult: "Go ahead." }, OPTS), "Go ahead");
  assert.equal(parseAnswer({ SpeechResult: "yeah do it" }, OPTS), "Go ahead");
  assert.equal(parseAnswer({ SpeechResult: "no, hold on" }, OPTS), "Wait");
  assert.equal(parseAnswer({ SpeechResult: "banana" }, OPTS), null);
  // Regression (review finding 2): negations never become a yes.
  assert.notEqual(parseAnswer({ SpeechResult: "No, don't go ahead" }, OPTS), "Go ahead");
  assert.equal(parseAnswer({ SpeechResult: "hold on let me go check" }, OPTS), "Wait");
  assert.equal(parseAnswer({}, OPTS), null);
});

test("call script briefs, asks with keys, escapes text", () => {
  const x = decisionTwiml({ greeting: "Hi <you>", briefing: "Demo is down & broken", question: "Revert it?", options: OPTS, actionUrl: "https://s.example/twilio/abc" });
  assert.match(x, /Hi &lt;you&gt;/);
  assert.match(x, /Demo is down &amp; broken/);
  assert.match(x, /press 1 for Go ahead, or press 2 for Wait/);
  assert.match(x, /action="https:\/\/s\.example\/twilio\/abc"/);
});

test("Twilio signature: matches Twilio's documented example, rejects tampering", () => {
  // Example from Twilio's security docs.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675310", Digits: "1234", From: "+14158675310", To: "+18005551212" };
  const sig = twilioSignature("12345", url, params);
  assert.equal(sig, "GvWf1cFY/Q7PnoempGyD5oXAezc=");
  assert.equal(validSignature("12345", url, params, sig), true);
  assert.equal(validSignature("12345", url, { ...params, Digits: "9" }, sig), false);
  assert.equal(validSignature("12345", url, params, undefined), false);
});

const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15550001111", OWNER_PHONE: "+919800000000", PUBLIC_BASE_URL: "https://s.example" };

function webhook(t, id, params, sign = true, suffix = "") {
  const body = new URLSearchParams(params).toString();
  const req = Readable.from([body]);
  req.url = `/twilio/${id}${suffix}`;
  req.method = "POST";
  req.headers = sign ? { "x-twilio-signature": twilioSignature(env.TWILIO_AUTH_TOKEN, `https://s.example/twilio/${id}${suffix}`, params) } : {};
  const res = { code: 0, body: "", writeHead(c) { this.code = c; return this; }, end(b) { this.body = b; } };
  return t.handleWebhook(req, res).then(() => res);
}

test("ring → owner says go ahead on the phone → answer resolves; forged webhooks are refused", async () => {
  assert.deepEqual(twilioMissing({}), ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "OWNER_PHONE", "PUBLIC_BASE_URL"]);
  let placed;
  const t = createTwilio(env, { fetchImpl: async (url, init) => { placed = { url, body: new URLSearchParams(init.body) }; return { ok: true, json: async () => ({ sid: "CA9" }) }; } });
  const call = await t.ring({ greeting: "Hi", briefing: "Demo is down", question: "Revert it?", options: OPTS, timeoutSec: 5 });
  assert.match(placed.url, /Accounts\/AC1\/Calls\.json$/);
  assert.equal(placed.body.get("To"), "+919800000000");
  assert.equal(placed.body.get("Twiml"), null, "trial accounts can't send inline TwiML");
  const id = placed.body.get("Url").match(/twilio\/([a-f0-9]{24})\/script$/)[1];
  const script = await webhook(t, id, { CallSid: "CA9" }, true, "/script");
  assert.match(script.body, /Demo is down/);
  assert.equal((await webhook(t, id, { CallSid: "CA9" }, false, "/script")).code, 403, "unsigned script fetch refused");

  const forged = await webhook(t, id, { SpeechResult: "go ahead" }, false);
  assert.equal(forged.code, 403);
  const unclear = await webhook(t, id, { SpeechResult: "banana" });
  assert.match(unclear.body, /didn't get that/);
  const ok = await webhook(t, id, { SpeechResult: "yes go ahead" });
  assert.match(ok.body, /Okay, Go ahead/);
  assert.equal(await call.answer, "Go ahead");
});
