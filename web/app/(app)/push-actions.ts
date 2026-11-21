'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { sendPush } from '@/lib/push';
import { toSlatesError } from '@/lib/slates';

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

export async function savePushSubscription(sub: Sub, userAgent: string) {
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: 'Invalid subscription' } as const;
  const sb = await supabaseServer();
  const { error } = await sb.rpc('push_subscribe', {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.keys.p256dh,
    p_auth: sub.keys.auth,
    p_user_agent: userAgent.slice(0, 200),
  });
  revalidatePath('/settings');
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}

export async function removePushSubscription(endpoint: string) {
  const sb = await supabaseServer();
  await sb.rpc('push_unsubscribe', { p_endpoint: endpoint });
  revalidatePath('/settings');
  return { ok: true } as const;
}

export async function saveNotificationPrefs(agent: boolean, brief: boolean, digest: boolean) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_notification_prefs', { p_agent: agent, p_brief: brief, p_digest: digest });
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}

export async function sendTestPush() {
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc('push_self_targets');
    if (error) throw new Error(error.message);
    const r = await sendPush(
      (data ?? []) as any[],
      { title: 'Slates notifications are on', body: 'Agents can now tap you on the shoulder.', url: '/settings', tag: 'test' },
      async (endpoint) => {
        await sb.rpc('push_unsubscribe', { p_endpoint: endpoint });
      },
    );
    return r.sent > 0 ? ({ ok: true } as const) : ({ ok: false, error: 'No device received it. Turn notifications off and on again.' } as const);
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}
