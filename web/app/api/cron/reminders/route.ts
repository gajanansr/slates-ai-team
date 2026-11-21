import { supabaseAnon } from '@/lib/supabase/server';
import { sendPush } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Due = { id: string; text: string; slug: string | null; repeat: string | null; due_local: string; subscriptions: any[] };

/**
 * Called every minute by Supabase pg_cron (via pg_net) only when something is due.
 * Claims due reminders (each exactly once) and pushes them.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const sb = supabaseAnon();
  const { data, error } = await sb.rpc('cron_due_reminders', { p_secret: secret });
  if (error) {
    console.error('[cron/reminders]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  let sent = 0;
  for (const r of (data ?? []) as Due[]) {
    const res = await sendPush(
      r.subscriptions ?? [],
      {
        title: r.text,
        body: r.repeat ? `Reminder · ${r.due_local} · repeats ${r.repeat}` : `Reminder · ${r.due_local}`,
        url: r.slug ? `/s/${r.slug}` : '/reminders',
        tag: `rem-${r.id}`,
        reminderId: r.id,
      },
      async (endpoint) => {
        await sb.rpc('push_prune', { p_endpoint: endpoint, p_secret: secret });
      },
    ).catch((e) => {
      console.error('[cron/reminders] push', e?.message);
      return { sent: 0 };
    });
    sent += res.sent;
  }
  return Response.json({ due: (data ?? []).length, sent });
}

export const POST = run;
export const GET = run;
