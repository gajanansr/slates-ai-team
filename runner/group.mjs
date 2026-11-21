// Group coordination: get several people to agree on one option, by phone.
// Pure helpers here; the runner does the calling, the board writes and the approval.

import { normalizePhone } from "./calls.mjs";

export function maskPhone(p) {
  const s = String(p || "");
  return s.length > 4 ? `••••${s.slice(-4)}` : s;
}

// Validates the tool input. Returns { ok: true, title, question, options, people } or { ok: false, reason }.
export function validateGroup(input, { maxPeople = 8 } = {}) {
  const title = String(input?.title || "").trim();
  const question = String(input?.question || "").trim();
  const options = [...new Set((input?.options || []).map((o) => String(o).trim()).filter(Boolean))];
  const raw = input?.people || [];
  if (!title) return { ok: false, reason: "title is required" };
  if (!question) return { ok: false, reason: "question is required" };
  if (options.length < 2 || options.length > 5) return { ok: false, reason: "give 2 to 5 options" };
  if (raw.length < 2) return { ok: false, reason: "a group needs at least 2 people" };
  if (raw.length > maxPeople) return { ok: false, reason: `at most ${maxPeople} people per group` };
  const people = [];
  const seen = new Set();
  for (const p of raw) {
    const phone = normalizePhone(p?.phone);
    const name = String(p?.name || "").trim();
    if (!name) return { ok: false, reason: "every person needs a name" };
    if (!phone) return { ok: false, reason: `${name}: phone must include the country code, like +919876543210` };
    if (seen.has(phone)) return { ok: false, reason: `${name}: the same number is listed twice` };
    seen.add(phone);
    people.push({ id: `p${people.length + 1}`, name, phone });
  }
  return { ok: true, title, question, options, people };
}

// Most-chosen option. A tie or nobody choosing means no winner.
export function tally(answers, options) {
  const counts = Object.fromEntries(options.map((o) => [o, 0]));
  for (const a of answers) if (a && counts[a] !== undefined) counts[a]++;
  const best = Math.max(...Object.values(counts));
  const top = options.filter((o) => counts[o] === best);
  return { counts, winner: best > 0 && top.length === 1 ? top[0] : null, tie: best > 0 && top.length > 1 };
}

export function groupApprovalQuestion({ title, people, options }) {
  return `Coordinate "${title}" with ${people.length} people by phone?\nOptions: ${options.join(" / ")}`.slice(0, 300);
}

export function groupApprovalDetails({ question, people }) {
  return [`They'll each be asked: ${question}`, ...people.map((p) => `• ${p.name} ${p.phone}`)].join("\n").slice(0, 700);
}

export const BOARD_COLUMNS = [
  { key: "person", label: "Person" },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status" },
  { key: "answer", label: "Answer" },
];

export function boardRow(person, status, answer = "") {
  return { id: person.id, cells: { person: person.name, phone: maskPhone(person.phone), status, answer } };
}

export function boardData(people) {
  return { columns: BOARD_COLUMNS, rows: people.map((p) => boardRow(p, "waiting")) };
}

export function groupSummaryNote({ title, question, options, people, results, result, boardUrl }) {
  const lines = people.map((p) => {
    const r = results[p.id] || {};
    return `- **${p.name}**: ${r.answer || r.status || "not reached"}${r.confirmed ? " ✓ confirmed" : ""}`;
  });
  const counts = options.map((o) => `- ${o}: ${result.counts[o]}`);
  const decision = result.winner ? `**${result.winner}**` : result.tie ? "Tie, the owner decides." : "No option was chosen.";
  const body = [
    `## Decision`, decision, ``,
    `## Question`, question, ``,
    `## Votes`, ...counts, ``,
    `## People`, ...lines,
    ...(boardUrl ? [``, `Live board: ${boardUrl}`] : []),
  ].join("\n");
  return { title: `Group: ${title}`.slice(0, 120), body, tags: ["calls", "group"] };
}
