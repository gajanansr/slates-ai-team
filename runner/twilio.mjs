// Ring the owner's real phone through Twilio when Slates needs a decision now.
// Slates reads the briefing on the call and listens for the answer ("go ahead" / "wait", or keys 1 / 2).
// Twilio posts the answer to PUBLIC_BASE_URL/twilio/<id>; every webhook is signature-checked.
//
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (Twilio number), OWNER_PHONE (verified mobile), PUBLIC_BASE_URL.

import crypto from "node:crypto";

export function twilioMissing(env) {
  return ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "OWNER_PHONE", "PUBLIC_BASE_URL"].filter((k) => !env[k]);
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

const GIVE_UP = "I didn't catch that. I'll leave it on your Slates desk. Goodbye.";

export function gatherTwiml({ question, options, actionUrl, voice = "Polly.Joanna" }) {
  const keys = options.map((o, i) => `press ${i + 1} for ${o}`).join(", or ");
  const ask = `${question} Say ${options.map((o) => `"${o}"`).join(" or ")}, or ${keys}.`;
  return `<Gather input="speech dtmf" numDigits="1" timeout="6" speechTimeout="auto" action="${xml(actionUrl)}" method="POST" hints="${xml(options.join(", "))}"><Say voice="${voice}">${xml(ask)}</Say></Gather>`;
}

// The call: brief, ask, listen for speech or a key. If they say nothing, ask once more, then give up politely.
export function decisionTwiml({ greeting, briefing, question, options, actionUrl, voice = "Polly.Joanna" }) {
  const gather = gatherTwiml({ question, options, actionUrl, voice });
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${voice}">${xml(greeting)}</Say><Pause length="1"/><Say voice="${voice}">${xml(briefing)}</Say>${gather}${gather}<Say voice="${voice}">${GIVE_UP}</Say></Response>`;
}

export function replyTwiml(text, voice = "Polly.Joanna") {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${voice}">${xml(text)}</Say><Hangup/></Response>`;
}

// What did they answer? Keys win; otherwise match the spoken words to an option (or common yes/no words).
export function parseAnswer({ Digits, SpeechResult }, options) {
  const d = Number(Digits);
  if (d >= 1 && d <= options.length) return options[d - 1];
  const said = String(SpeechResult || "").toLowerCase();
  if (!said) return null;
  // Negation first: "No, don't go ahead" must never become a yes. Anything unclear → null (it asks again).
  const negative = /\b(no|nope|not|don'?t|do not|wait|hold|stop|cancel|later|never)\b/.test(said);
  const positive = /\b(yes|yeah|yep|do it|proceed|approve|go ahead|revert it)\b/.test(said);
  if (negative && positive) return null;
  if (negative) return options[1] || null;
  const exact = options.filter((o) => said.includes(o.toLowerCase()));
  if (exact.length === 1) return exact[0];
  if (positive) return options[0];
  return null;
}

// Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)))
export function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function validSignature(authToken, url, params, header) {
  if (!header) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(String(header));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function createTwilio(env, { fetchImpl = fetch, log = () => {} } = {}) {
  if (twilioMissing(env).length) return null;
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const pending = new Map(); // id → { options, resolve, callSid }
  const auth = `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
  const api = (path, form) => fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}${path}`, {
    method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString(),
  });

  return {
    // Rings the owner. Returns { answer: Promise<option|null>, cancel() }.
    async ring({ greeting, briefing, question, options, timeoutSec = 180 }) {
      const id = crypto.randomBytes(12).toString("hex");
      let resolve;
      const answer = new Promise((r) => { resolve = r; });
      const twiml = decisionTwiml({ greeting, briefing: briefing.slice(0, 900), question, options, actionUrl: `${base}/twilio/${id}` });
      const entry = { options, question, resolve, callSid: null, misses: 0, twiml };
      pending.set(id, entry);
      const timer = setTimeout(() => finish(null), timeoutSec * 1000);
      function finish(v) {
        clearTimeout(timer);
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve(v);
      }
      try {
        const res = await api("/Calls.json", {
          // Trial accounts can't send TwiML inline, so Twilio fetches the call script from us (signed request).
          To: env.OWNER_PHONE, From: env.TWILIO_FROM, Timeout: "30", Url: `${base}/twilio/${id}/script`, Method: "POST",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { log(`  (twilio call failed: ${j.message || res.status})`); finish(null); }
        else { entry.callSid = j.sid; log(`  📱 ringing ${env.OWNER_PHONE.slice(0, 3)}••••${env.OWNER_PHONE.slice(-3)} (twilio ${j.sid})`); }
      } catch (err) {
        log(`  (twilio call failed: ${err.message})`);
        finish(null);
      }
      return {
        answer,
        cancel: async () => {
          const sid = entry.callSid;
          finish(null);
          if (sid) await api(`/Calls/${sid}.json`, { Status: "completed" }).catch(() => {});
        },
      };
    },

    // Webhook from Twilio with the owner's answer. Returns true if handled.
    async handleWebhook(req, res) {
      const m = req.url.match(/^\/twilio\/([a-f0-9]{24})(\/script)?$/);
      if (!m || req.method !== "POST") return false;
      let body = "";
      for await (const c of req) body += c;
      const params = Object.fromEntries(new URLSearchParams(body));
      const send = (code, text) => res.writeHead(code, { "content-type": "text/xml" }).end(text);
      if (!validSignature(env.TWILIO_AUTH_TOKEN, `${base}${req.url}`, params, req.headers["x-twilio-signature"])) {
        log("  (twilio webhook with a bad signature, ignored)");
        send(403, replyTwiml("Sorry."));
        return true;
      }
      const entry = pending.get(m[1]);
      if (!entry) { send(200, replyTwiml("This decision was already made. Goodbye.")); return true; }
      if (m[2]) { send(200, entry.twiml); return true; } // Twilio fetching the call script
      const choice = parseAnswer(params, entry.options);
      if (!choice) {
        entry.misses++;
        if (entry.misses >= 2) { send(200, replyTwiml(GIVE_UP)); return true; } // the runner falls back to Telegram/desk on timeout
        send(200, `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Sorry, I didn't get that.</Say>${gatherTwiml({ question: entry.question, options: entry.options, actionUrl: `${base}/twilio/${m[1]}` })}<Say voice="Polly.Joanna">${GIVE_UP}</Say></Response>`);
        return true;
      }
      pending.delete(m[1]);
      entry.resolve(choice);
      send(200, replyTwiml(`Okay, ${choice}. Your agents are on it. Goodbye.`));
      return true;
    },
  };
}
