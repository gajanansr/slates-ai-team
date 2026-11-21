// "Agents at work": one live table board in Slates showing what every agent is doing right now.
// Pure helpers only (rows, trimming, text); the runner does the Slates writes.

export const WORK_BOARD = { slug: "agents-at-work", title: "Agents at work", icon: "bot", category: "Work" };
export const WORK_MAX_ROWS = 25;

export const WORK_COLUMNS = [
  { key: "agent", label: "Agent" },
  { key: "task", label: "Task" },
  { key: "status", label: "Status" },
  { key: "started", label: "Started" },
  { key: "update", label: "Update" },
  { key: "result", label: "Result" },
];

export const STATUS = { queued: "queued", working: "working", needsYou: "needs you", done: "done", failed: "failed" };
const FINISHED = new Set([STATUS.done, STATUS.failed]);

export function short(s, max) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// "HH:MM" in the given time zone (default Asia/Kolkata).
export function clockTime(date = new Date(), timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(date));
}

// A one-line result from an agent's final answer: its first real line, plus the first link if that line has none.
export function resultLine(text, max = 140) {
  const lines = String(text ?? "").split("\n").map((l) => l.replace(/^[\s#>*\-•]+|[*`]+/g, "").trim()).filter(Boolean);
  const line = lines[0] || "";
  const url = String(text ?? "").match(/https?:\/\/[^\s)<>\]"']+/)?.[0];
  if (url && !line.includes(url) && url.length <= 200) {
    const room = max - url.length - 1;
    const head = room >= 20 ? short(line, room) : "";
    return head ? `${head} ${url}` : url;
  }
  return short(line, max);
}

// Apply one change to the board rows (a list of { id, cells }, oldest first).
// `patch` holds any of: agent, task, status, update, result. A new row gets `started` from `now`.
// Returns { rows, row, removed }: the new list, the changed row, and ids trimmed to keep at most `max` rows
// (oldest done/failed first; active rows are never removed, so the list may briefly exceed `max`).
export function applyWorkUpdate(rows, id, patch, { now = new Date(), timeZone = "Asia/Kolkata", max = WORK_MAX_ROWS } = {}) {
  id = String(id);
  const list = (rows || []).map((r) => ({ id: r.id, cells: { ...r.cells } }));
  let row = list.find((r) => r.id === id);
  if (!row) {
    row = { id, cells: { agent: "", task: "", status: STATUS.queued, started: clockTime(now, timeZone), update: "", result: "" } };
    list.push(row);
  }
  const limits = { agent: 40, task: 120, status: 40, update: 160, result: 240 };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined || !(k in limits)) continue;
    row.cells[k] = short(v, limits[k]);
  }
  const removed = [];
  for (const r of [...list]) {
    if (list.length <= max) break;
    if (r.id !== id && FINISHED.has(r.cells.status)) {
      list.splice(list.indexOf(r), 1);
      removed.push(r.id);
    }
  }
  return { rows: list, row: { id: row.id, cells: { ...row.cells } }, removed };
}

// Arguments for create_slate when the board doesn't exist yet.
export function workBoardCreateArgs(rows) {
  return {
    ...WORK_BOARD, kind: "table", pinned: true,
    data: { columns: WORK_COLUMNS, rows: (rows || []).map((r) => ({ id: r.id, cells: { ...r.cells } })) },
    note: "Live view of what every agent is doing",
  };
}
