import { test } from "node:test";
import assert from "node:assert/strict";
import { ntfyRequest, createNtfy } from "../ntfy.mjs";

test("ntfy urgent alert carries a Join call button", () => {
  const { url, init } = ntfyRequest({ topic: "slates-abc", title: "Slates is calling", message: "Demo down", priority: 5, tags: ["rotating_light"], click: "https://x/c/1", actions: [{ label: "Join call", url: "https://x/c/1" }] });
  assert.equal(url, "https://ntfy.sh/slates-abc");
  assert.equal(init.headers.Priority, "5");
  assert.equal(init.headers.Actions, "view, Join call, https://x/c/1, clear=true");
  assert.equal(init.body, "Demo down");
});

test("no topic → no ntfy; emoji are kept out of headers", async () => {
  assert.equal(createNtfy({}), null);
  let sent;
  const send = createNtfy({ NTFY_TOPIC: "t" }, { fetchImpl: async (u, i) => { sent = i; return { ok: true }; } });
  await send({ title: "🚨 Down", message: "body 🚨" });
  assert.equal(sent.headers.Title, "Down");
  assert.equal(sent.body, "body 🚨");
});
