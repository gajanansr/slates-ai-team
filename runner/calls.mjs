// Phone calls made by agents: guardrails, records and providers.
import { agoraProvider } from "./agora.mjs";
// The runner enforces every rule here in code; the agent cannot talk its way past them.

// "+91 98765-43210" → "+919876543210". Needs a country code; returns null if it can't be sure.
export function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s.startsWith("+")) return null;
  const digits = s.slice(1).replace(/[\s\-().]/g, "");
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

// Hour 0-23 in a time zone.
export function hourIn(date, timeZone) {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) }).format(date);
  return Number(h);
}

// "21-9" → quiet from 21:00 until 09:00. "0-24" → always quiet. "" → never.
export function isQuietHour(hour, quietHours) {
  const m = String(quietHours || "").match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const [start, end] = [Number(m[1]), Number(m[2])];
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// Checks that don't need the owner. Returns { ok: true, phone } or { ok: false, reason }.
export function checkCall({ phone, callsSoFar, maxCalls, now = new Date(), quietHours, timeZone, allowedPrefixes = [] }) {
  const p = normalizePhone(phone);
  if (!p) return { ok: false, reason: "Phone number must include the country code, like +919876543210." };
  if (allowedPrefixes.length && !allowedPrefixes.some((pre) => p.startsWith(pre))) {
    return { ok: false, reason: `Calls to ${p} are not allowed (allowed prefixes: ${allowedPrefixes.join(", ")}).` };
  }
  if (callsSoFar >= maxCalls) return { ok: false, reason: `This task already made ${callsSoFar} call(s); the limit is ${maxCalls}.` };
  const hour = hourIn(now, timeZone);
  if (isQuietHour(hour, quietHours)) return { ok: false, reason: `It's ${hour}:00, inside quiet hours (${quietHours}). Try again later or ask the owner.` };
  return { ok: true, phone: p };
}

// Every call opens by saying it's an AI and who it's for. Not optional.
export function disclosureGreeting(ownerName, calleeName) {
  const hi = calleeName ? `Hi ${calleeName}` : "Hi";
  return `${hi}, this is an AI assistant calling on behalf of ${ownerName}. Is now a good time for a quick call?`;
}

export function callApprovalQuestion({ name, phone, goal }) {
  return `Call ${name ? `${name} (${phone})` : phone}?\nGoal: ${goal}`.slice(0, 300);
}

export function callNote({ name, phone, goal, result, taskId, agentName, at = new Date() }) {
  const who = name ? `${name} (${phone})` : phone;
  const lines = (result.transcript || []).map((l) => `**${l.speaker}:** ${l.text}`);
  const body = [
    `**Call to ${who}** · ${result.status} · ${Math.round((result.durationSec || 0) / 6) / 10} min`,
    `Made by ${agentName} for desk item \`${taskId}\` on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ``,
    `## Goal`,
    goal,
    ``,
    `## Outcome`,
    result.summary || "(no summary)",
    ``,
    `## Transcript`,
    lines.length ? lines.join("\n\n") : "(none)",
  ].join("\n");
  return { title: `Call: ${name || phone} – ${goal}`.slice(0, 120), body: body.slice(0, 20000), tags: ["calls"] };
}

// ---------- providers ----------
// A provider places one call and returns { status, transcript: [{speaker, text}], summary, durationSec }.
// status: "completed" | "no_answer" | "failed".
// When `options` is passed (group coordination), it also returns `choice`: one of the options, or null.

export function createCallProvider(env) {
  const kind = env.CALL_PROVIDER || "";
  if (kind === "simulated") return simulatedProvider(env);
  if (kind === "agora") return agoraProvider(env, { log: (m) => console.log(m) });
  return null;
}

// Plays a scripted conversation. For demos and tests; never dials anyone.
// CALL_SIM_CHOICES (JSON) scripts group answers per name: {"Ramesh": "Sat 8pm", "Priya": null, "Amit": "noanswer-once:Sun 1pm"}
//   null → never picks up; "noanswer-once:X" → misses the first call, answers X on the next.
function simulatedProvider(env) {
  const choices = env.CALL_SIM_CHOICES ? JSON.parse(env.CALL_SIM_CHOICES) : {};
  const attempts = new Map();
  return {
    name: "simulated",
    async call({ name, goal, greeting, options }) {
      if (options) {
        const n = (attempts.get(name) || 0) + 1;
        attempts.set(name, n);
        let pick = name in choices ? choices[name] : options[0];
        if (typeof pick === "string" && pick.startsWith("noanswer-once:")) pick = n === 1 ? null : pick.slice(14);
        if (pick === null) return { status: "no_answer", transcript: [], summary: "Nobody picked up.", durationSec: 30, choice: null };
        const said = options.includes(pick) ? `${pick} works for me.` : `None of those work for me.`;
        return {
          status: "completed",
          durationSec: 60,
          choice: options.includes(pick) ? pick : null,
          transcript: [
            { speaker: "Agent", text: greeting },
            { speaker: name, text: "Sure." },
            { speaker: "Agent", text: goal },
            { speaker: name, text: said },
          ],
          summary: `${name} said: "${said}"`,
        };
      }
      const outcome = env.CALL_SIM_OUTCOME || "completed";
      if (outcome === "no_answer") return { status: "no_answer", transcript: [], summary: "Nobody picked up.", durationSec: 30 };
      return {
        status: "completed",
        durationSec: 75,
        transcript: [
          { speaker: "Agent", text: greeting },
          { speaker: name || "Callee", text: "Yes, go ahead." },
          { speaker: "Agent", text: `I'm calling about this: ${goal}` },
          { speaker: name || "Callee", text: env.CALL_SIM_REPLY || "Sure, that works for me." },
          { speaker: "Agent", text: "Thank you, I'll pass that on. Bye!" },
        ],
        summary: `${name || "They"} said: "${env.CALL_SIM_REPLY || "Sure, that works for me."}"`,
      };
    },
  };
}

// Real calls: see agora.mjs (Agora Conversational AI + Murf voice, via a call link).
