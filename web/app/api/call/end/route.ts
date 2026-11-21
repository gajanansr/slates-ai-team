import { supabaseServer } from '@/lib/supabase/server';
import { endCall } from '@/lib/call-server';
import { toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';

/** End a call: the agent leaves and the per-call token is revoked. Idempotent; also receives navigator.sendBeacon. */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'forbidden' }, { status: 403 });
  let callRef: unknown;
  try {
    // sendBeacon posts text/plain, so parse the body by hand.
    callRef = (JSON.parse(await req.text()) as { callRef?: unknown })?.callRef;
  } catch {
    return Response.json({ error: 'Send {callRef}' }, { status: 400 });
  }
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    return Response.json(await endCall({ sb }, data.user.id, callRef));
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
