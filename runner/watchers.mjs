// Watchers: Slates keeps an eye on things and starts agents by itself when something happens.
// First kind: a website being up. Pure helpers here; the runner does the fetching and acting.

// WATCH_URLS="sahayak=https://getsahayak.vercel.app; demo=https://x.github.io/demo"
// Optional repo per watcher: WATCH_REPOS="demo=gajanansr/slates-oncall-demo"
// Optional text the page must contain: WATCH_EXPECT="demo=All systems running"
const pairs = (str) => Object.fromEntries(
  String(str || "").split(/[;]/).map((s) => s.trim()).filter(Boolean).map((s) => [s.slice(0, s.indexOf("=")).trim(), s.slice(s.indexOf("=") + 1).trim()]),
);

export function parseWatchers(urls, repos = "", expects = "") {
  const repoOf = pairs(String(repos || "").replace(/,/g, ";"));
  const expectOf = pairs(expects);
  return String(urls || "").split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf("=");
    const name = i > 0 ? s.slice(0, i).trim() : s.replace(/^https?:\/\//, "").split("/")[0];
    const url = i > 0 ? s.slice(i + 1).trim() : s;
    if (!/^https?:\/\//.test(url)) throw new Error(`watcher "${name}": url must start with http(s)://`);
    return { name, url, repo: repoOf[name] || "", ...(expectOf[name] ? { expect: expectOf[name] } : {}) };
  });
}

// One check result → new state + what happened. Down only after `failsToAlert` failures in a row (no flapping).
export function stepWatcher(prev, { ok, status, error, at }, { failsToAlert = 2 } = {}) {
  const s = { up: true, fails: 0, downSince: null, lastStatus: null, ...prev };
  const detail = ok ? `HTTP ${status}` : error ? error : `HTTP ${status}`;
  if (ok) {
    const wasDown = !s.up;
    const next = { up: true, fails: 0, downSince: null, lastStatus: detail };
    return { state: next, event: wasDown ? { type: "up", downSince: s.downSince, at, detail } : null };
  }
  const fails = s.fails + 1;
  const downSince = s.downSince || at;
  if (s.up && fails >= failsToAlert) {
    return { state: { up: false, fails, downSince, lastStatus: detail }, event: { type: "down", downSince, at, detail } };
  }
  return { state: { ...s, fails, downSince, lastStatus: detail }, event: null };
}

export function minutesBetween(a, b) {
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 6000) / 10);
}

export const INCIDENT_COLUMNS = [
  { key: "time", label: "Time" },
  { key: "who", label: "Who" },
  { key: "what", label: "What happened" },
];

export function incidentRow(id, at, who, what) {
  return { id, cells: { time: new Date(at).toISOString().slice(11, 19) + " UTC", who, what: String(what).slice(0, 300) } };
}

export function incidentSlug(name, at) {
  return `incident-${name}-${new Date(at).toISOString().slice(0, 16).replace(/[^0-9]/g, "")}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
}

// The task an agent gets when a site goes down. Slates caps handoff context at 400 chars, so the context
// only carries a marker (watcher, board, repo); the full playbook is added to the agent's prompt from the marker.
export function incidentTask(w, ev, { slug, ownerName }) {
  const task = `INCIDENT: ${w.name} (${w.url}) is down since ${new Date(ev.downSince).toISOString().slice(11, 16)} UTC (${ev.detail}). Investigate, call ${ownerName} for a go-ahead, then fix.`;
  const context = `${incidentMarker({ name: w.name, slug, repo: w.repo })} Started by the Slates watcher.`;
  return { task: task.slice(0, 400), context: context.slice(0, 400) };
}

export function incidentMarker({ name, slug, repo }) {
  return `[incident:${name}|${slug}|${repo || "-"}]`;
}

export function parseIncidentMarker(text) {
  const m = String(text || "").match(/\[incident:([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/);
  return m ? { name: m[1], slug: m[2], repo: m[3] === "-" ? "" : m[3] } : null;
}

// What the agent must do on an incident. Safe by construction: the only fix is a revert, after the owner's spoken yes.
export function incidentPlaybook({ name, slug, repo }, { ownerName = "the owner", gemini = false, calls = false } = {}) {
  return [
    `This is an incident started by the Slates watcher: "${name}" is down.`,
    `Live incident board: slug "${slug}" (kind table, columns time, who, what). Add a row with patch_items for every finding, newest last, with who = your name. Keep each row one short sentence.`,
    repo ? `The site's code is the GitHub repo ${repo}. Use the gh and git CLIs to look at recent commits, the diff of the latest ones and recent workflow runs.` : `No GitHub repo is linked to this site, so investigate from the error alone and do not try to fix code.`,
    `Steps:`,
    `1. Find the most likely cause. Be specific: commit sha, author, message, and the exact line or file that breaks.`,
    gemini ? `2. Call ask_gemini with your evidence for an independent second opinion. Add Gemini's verdict to the board as who = "Gemini", and say whether it agrees.` : `2. (No second model is connected; say on the board that only Claude reviewed it.)`,
    calls
      ? `3. Call ask_owner_by_call to phone ${ownerName}. headline: a few words ("${name} is down"). briefing: plain spoken English, under 60 words: what broke, since when, the cause, and what you want to do. question: "Should we go ahead and revert it?". options: ["Go ahead", "Wait"]. team_says: what you (Claude) found, in first person, under 50 words${gemini ? `, and Gemini's verdict in Gemini's first person, under 40 words` : ""}. Slates hosts the call and your team speaks in their own voices.`
      : `3. Call request_approval with a one-line yes/no question to revert the bad commit.`,
    `4. Only if the answer is "Go ahead" (or APPROVED): fix it safely by reverting the bad commit: clone the repo into this folder, git revert <sha> --no-edit, git push to the default branch. Never force-push, delete branches, change settings or secrets. If the answer is anything else, do nothing and add a row saying ${ownerName} said to wait. The answer from ask_owner_by_call IS the owner's approval for the revert: do not call request_approval again for it.`,
    `5. Add a final board row with what you did. The watcher confirms recovery by itself.`,
  ].join("\n");
}
