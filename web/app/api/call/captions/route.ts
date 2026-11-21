import { supabaseServer } from '@/lib/supabase/server';
import { callCaptions } from '@/lib/call-server';
import { toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';

/** Live captions for a call the signed-in user started: GET /api/call/captions?ref=<callRef>[&step=<n>]. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ref = params.get('ref');
  // Standups: how far the script got (the last /next step the page asked for).
  const step = params.has('step') ? Number(params.get('step')) : undefined;
  if (!ref) return Response.json({ error: 'Send ?ref=' }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    return Response.json(await callCaptions({ sb }, data.user.id, ref, step), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
