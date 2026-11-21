import { supabaseServer } from '@/lib/supabase/server';
import { reminders } from '@/lib/reminders';
import { toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';

/** Notification buttons (Done / Snooze 1h). Same-origin, session-cookie auth only. */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'forbidden' }, { status: 403 });
  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!body.id || !/^[0-9a-f-]{36}$/.test(body.id) || !['done', 'snooze'].includes(body.action ?? '')) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  try {
    const caller = { client: await supabaseServer(), token: null };
    if (body.action === 'done') await reminders.complete(caller, body.id);
    else await reminders.snooze(caller, body.id, 60);
    return Response.json({ ok: true });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
