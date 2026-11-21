import { supabaseServer } from '@/lib/supabase/server';
import { startCall } from '@/lib/call-server';
import { profileOf } from '@/lib/profile';
import { toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

/** Start a voice call with Slates, a standup ({mode: "standup", since?: ISO}), or a call with one of your agents ({agent: "<slug>"}). Session-cookie auth, same-origin only. */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'forbidden' }, { status: 403 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { mode?: unknown; since?: unknown; agent?: unknown } | null;
  const mode = body?.mode === 'standup' ? 'standup' : 'call';
  try {
    const call = await startCall({ sb }, { id: data.user.id, firstName: profileOf(data.user).name }, { mode, since: body?.since, ...(body?.agent !== undefined && body?.agent !== null ? { agent: body.agent } : {}) });
    return Response.json(call, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
