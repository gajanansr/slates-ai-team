import { supabaseServer } from '@/lib/supabase/server';
import { history } from '@/lib/history';

export const dynamic = 'force-dynamic';

/** Beacon from Home when the user leaves: "since you last looked" restarts from now. */
export async function POST() {
  const client = await supabaseServer();
  try {
    await history.seen({ client, token: null });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 401 });
  }
}
