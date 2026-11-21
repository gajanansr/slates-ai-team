import { supabaseAnon } from '@/lib/supabase/server';
import { runDueAutomations } from '@/lib/automations-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Called every 15 minutes by pg_cron (only when something is due). Claims due
 * automations and runs each as the user's built-in Slates agent.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  try {
    const results = await runDueAutomations(supabaseAnon(), secret);
    return Response.json({ ran: results.length, results: results.map((r) => r.status) });
  } catch (e: any) {
    console.error('[cron/automations]', e);
    return Response.json({ error: e?.message }, { status: 500 });
  }
}

export const GET = POST;
