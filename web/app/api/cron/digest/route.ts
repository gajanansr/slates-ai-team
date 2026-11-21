import { supabaseAnon } from '@/lib/supabase/server';
import { sendPush } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Row = { owner_id: string; changes: number; agents: string[] | null; slates: string[] | null; subscriptions: any[] };

/** Vercel Cron (daily, 20:00 IST): one evening push summarising what agents changed. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const sb = supabaseAnon();
  const { data, error } = await sb.rpc('cron_digest', { p_secret: secret });
  if (error) {
    console.error('[cron/digest]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  let sent = 0;
  for (const row of (data ?? []) as Row[]) {
    const who = (row.agents ?? []).slice(0, 2).join(' and ') || 'Your agents';
    const where = (row.slates ?? []).length ? ` · ${(row.slates ?? []).join(', ')}` : '';
    const r = await sendPush(
      row.subscriptions ?? [],
      { title: 'Your day in Slates', body: `${who} made ${row.changes} change${row.changes === 1 ? '' : 's'}${where}`, url: '/activity', tag: 'digest' },
      async (endpoint) => {
        await sb.rpc('push_prune', { p_endpoint: endpoint, p_secret: secret });
      },
    );
    sent += r.sent;
  }
  return Response.json({ owners: (data ?? []).length, sent });
}
