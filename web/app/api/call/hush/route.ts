import { supabaseServer } from '@/lib/supabase/server';
import { callHush } from '@/lib/call-server';
import { toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';

/**
 * Barge-in: the page heard you talk over an agent. POST {callRef, uids?}: Slates is interrupted, and the
 * runner interrupts every live agent that is speaking and gives you the floor.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { callRef?: unknown; uids?: unknown } | null;
  if (!body?.callRef) return Response.json({ error: 'Send {callRef}' }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    return Response.json(await callHush({ sb }, data.user.id, body.callRef, body.uids), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
