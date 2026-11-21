import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWatchers, stepWatcher, minutesBetween, incidentTask, parseIncidentMarker, incidentPlaybook } from "../watchers.mjs";
import { buildPrompt } from "../lib.mjs";

test("parseWatchers reads names, urls and repos", () => {
  assert.deepEqual(parseWatchers("demo=https://a.io; https://b.io/x", "demo=me/repo"), [
    { name: "demo", url: "https://a.io", repo: "me/repo" },
    { name: "b.io", url: "https://b.io/x", repo: "" },
  ]);
  assert.deepEqual(parseWatchers(""), []);
  assert.equal(parseWatchers("demo=https://a.io", "", "demo=All systems running")[0].expect, "All systems running");
  assert.throws(() => parseWatchers("x=ftp://nope"), /must start with http/);
});

test("stepWatcher: down only after N failures, up event with downtime", () => {
  let s, e;
  ({ state: s, event: e } = stepWatcher(undefined, { ok: false, status: 500, at: "2026-11-21T10:00:00Z" }));
  assert.equal(e, null);
  ({ state: s, event: e } = stepWatcher(s, { ok: false, status: 502, at: "2026-11-21T10:00:30Z" }));
  assert.deepEqual(e, { type: "down", downSince: "2026-11-21T10:00:00Z", at: "2026-11-21T10:00:30Z", detail: "HTTP 502" });
  ({ state: s, event: e } = stepWatcher(s, { ok: false, error: "timed out", at: "2026-11-21T10:01:00Z" }));
  assert.equal(e, null, "no repeat alerts while down");
  ({ state: s, event: e } = stepWatcher(s, { ok: true, status: 200, at: "2026-11-21T10:03:00Z" }));
  assert.equal(e.type, "up");
  assert.equal(minutesBetween(e.downSince, e.at), 3);
  assert.equal(stepWatcher(s, { ok: true, status: 200, at: "x" }).event, null);
});

test("incident handoff fits Slates limits and the prompt gets the safe playbook", () => {
  const w = { name: "demo", url: "https://demo.io", repo: "me/repo" };
  const { task, context } = incidentTask(w, { downSince: "2026-11-21T10:00:00Z", detail: "HTTP 500" }, { slug: "incident-demo-1", ownerName: "Gajanan" });
  assert.ok(task.length <= 400 && context.length <= 400);
  assert.deepEqual(parseIncidentMarker(context), { name: "demo", slug: "incident-demo-1", repo: "me/repo" });
  const p = buildPrompt({ id: "h1", kind: "handoff", from: "Claude", task, context }, { calls: true, gemini: true, ownerName: "Gajanan" });
  assert.match(p, /ask_owner_by_call/);
  assert.match(p, /ask_gemini/);
  assert.match(p, /Never force-push/);
  assert.match(incidentPlaybook({ name: "x", slug: "s", repo: "" }), /do not try to fix code/);
  assert.equal(parseIncidentMarker("no marker here"), null);
});
