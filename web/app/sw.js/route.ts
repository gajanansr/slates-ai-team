/**
 * Service worker, generated per deploy so the cache version bumps automatically.
 *  - Navigations: network-first; on failure serve the last cached copy, else /offline.
 *  - /_next/static, fonts, icons: cache-first (content-hashed / immutable).
 *  - API, MCP, auth and Supabase: never cached.
 *  - On sign-out the page posts {type:'clear'} and all caches are dropped.
 */
const VERSION = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? 'dev').slice(0, 12);

const source = (version: string) => `
const VERSION = ${JSON.stringify(version)};
const PAGES = 'slates-pages-' + VERSION;
const ASSETS = 'slates-assets-' + VERSION;
const OFFLINE = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES).then((c) => c.addAll([OFFLINE, '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

// Push: agents and the daily digest. Payload: {title, body, url, tag}.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: event.data && event.data.text() }; }
  const url = typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//') ? d.url : '/home';
  event.waitUntil(self.registration.showNotification(d.title || 'Slates', {
    body: d.body || '',
    badge: '/badge-72.png?v=3',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url, reminderId: d.reminderId || null },
    actions: d.reminderId ? [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 1h' }] : [],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.reminderId && (event.action === 'done' || event.action === 'snooze')) {
    // Act without opening the app; fall back to opening Reminders if the session is gone.
    event.waitUntil(
      fetch('/api/reminders/action', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.reminderId, action: event.action }),
      }).then((r) => (r.ok ? null : self.clients.openWindow('/reminders'))).catch(() => self.clients.openWindow('/reminders'))
    );
    return;
  }
  const url = data.url || '/home';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});

const NEVER = [/^\\/api\\//, /^\\/mcp/, /^\\/auth\\//, /^\\/settings\\/admin/];
// Signed-in app screens that can open from a saved copy.
const APP = /^\\/(home|boards|notes|reminders|inbox|s|activity|agents|settings)(\\/|$)/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((r) => r.test(url.pathname))) return;

  if (req.mode === 'navigate') {
    // Fetch the page and keep a copy. Signed out (bounced to /)? Forget saved private pages.
    const network = fetch(req).then((res) => {
      if (res.redirected && new URL(res.url).pathname === '/') caches.delete(PAGES);
      if (res.ok && !res.redirected) {
        const copy = res.clone();
        caches.open(PAGES).then((c) => c.put(req, copy));
      }
      return res;
    });

    // App screens open instantly from the saved copy (like a native app), then refresh in place
    // once the fresh page has arrived. Everything else: network first.
    if (APP.test(url.pathname)) {
      event.respondWith((async () => {
        const saved = await caches.match(req);
        if (!saved) return network.catch(async () => (await caches.match(OFFLINE)) || Response.error());
        event.waitUntil(
          network
            .then(async (res) => {
              if (!res.ok || res.redirected) return;
              const id = event.resultingClientId || event.clientId;
              // The page may still be starting up: try a few times.
              for (let i = 0; i < 20; i++) {
                const client = id && (await self.clients.get(id));
                if (client) return client.postMessage({ type: 'slates:stale' });
                await new Promise((r) => setTimeout(r, 250));
              }
            })
            .catch(() => {})
        );
        return saved;
      })());
      return;
    }

    event.respondWith(network.catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE)) || Response.error()));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || /\\.(png|svg|woff2?|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
`;

export function GET() {
  return new Response(source(VERSION), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
