import 'server-only';
import webpush, { type PushSubscription } from 'web-push';
import { SITE_URL, VAPID_PUBLIC_KEY } from '@/lib/env';
import { SlatesError } from '@/lib/slates';

export type PushPayload = { title: string; body?: string; url?: string; tag?: string; reminderId?: string };
type Target = { endpoint: string; keys: { p256dh: string; auth: string } };

let configured = false;
function configure() {
  if (configured) return;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) throw new SlatesError('Push is not configured on the server (VAPID_PRIVATE_KEY missing).', 503, 'unavailable');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? `${SITE_URL}`, VAPID_PUBLIC_KEY, priv);
  configured = true;
}

/** Only same-site paths may be opened from a notification. */
export function safePushUrl(url?: string) {
  if (!url || !url.startsWith('/') || url.startsWith('//') || /[\\\s]/.test(url)) return '/home';
  return url;
}

/**
 * Send to every target; returns counts. Dead subscriptions (404/410) are passed to
 * `prune` so they can be removed.
 */
export async function sendPush(targets: Target[], payload: PushPayload, prune: (endpoint: string) => Promise<unknown>) {
  if (targets.length === 0) return { sent: 0, failed: 0 };
  configure();
  const body = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body?.slice(0, 300),
    url: safePushUrl(payload.url),
    tag: payload.tag,
    reminderId: payload.reminderId && /^[0-9a-f-]{36}$/.test(payload.reminderId) ? payload.reminderId : undefined,
  });
  let sent = 0;
  let failed = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        await webpush.sendNotification(t as PushSubscription, body, { TTL: 60 * 60 * 12, urgency: 'normal' });
        sent++;
      } catch (e: any) {
        failed++;
        if (e?.statusCode === 404 || e?.statusCode === 410) await prune(t.endpoint).catch(() => {});
        else console.error('[push] send failed', e?.statusCode, e?.body ?? e?.message);
      }
    }),
  );
  return { sent, failed };
}
