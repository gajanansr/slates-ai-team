// Loud push alerts through ntfy (github.com/binwiederhier/ntfy): free, open source, no account.
// The owner installs the ntfy app and subscribes to NTFY_TOPIC (a long random name = the only secret).
// Urgent alerts (priority 5) vibrate long and pop up; a "Join call" button opens the Slates call.

export function ntfyRequest({ server = "https://ntfy.sh", topic, title, message, priority = 4, tags = [], click, actions = [] }) {
  const headers = { Title: title, Priority: String(priority), "Content-Type": "text/plain; charset=utf-8" };
  if (tags.length) headers.Tags = tags.join(",");
  if (click) headers.Click = click;
  if (actions.length) headers.Actions = actions.map((a) => `view, ${a.label}, ${a.url}, clear=true`).join("; ");
  return { url: `${server.replace(/\/$/, "")}/${encodeURIComponent(topic)}`, init: { method: "POST", headers, body: message } };
}

export function createNtfy(env, { fetchImpl = fetch, log = () => {} } = {}) {
  if (!env.NTFY_TOPIC) return null;
  return async function send(opts) {
    // HTTP header values must be Latin-1; keep emoji in the body only.
    const title = String(opts.title || "Slates").replace(/[^\x20-\x7E]/g, "").trim() || "Slates";
    const { url, init } = ntfyRequest({ server: env.NTFY_SERVER, topic: env.NTFY_TOPIC, ...opts, title });
    try {
      const res = await fetchImpl(url, init);
      if (!res.ok) log(`  (ntfy ${res.status})`);
    } catch (err) {
      log(`  (ntfy failed: ${err.message})`);
    }
  };
}
