import { supabaseServer } from '@/lib/supabase/server';
import { standupNext } from '@/lib/call-server';
import { toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';

/**
 * Standup turn-taking: the page calls this when the previous voice went quiet, with {callRef, step}.
 * The agent for that step says its line. A step past the end is a no-op ({done: true}).
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { callRef?: unknown; step?: unknown } | null;
  if (!body?.callRef) return Response.json({ error: 'Send {callRef, step}' }, { status: 400 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    return Response.json(await standupNext({ sb }, data.user.id, body.callRef, body.step), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
