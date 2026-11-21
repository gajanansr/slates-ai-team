import { supabaseServer } from '@/lib/supabase/server';
import { slates, toSlatesError } from '@/lib/slates';

export const dynamic = 'force-dynamic';

/** Signed-in user's own data as a JSON download (session cookie auth). */
export async function GET() {
  try {
    const client = await supabaseServer();
    const { data } = await client.auth.getUser();
    if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
    const caller = { client, token: null };
    const [all, activity] = await Promise.all([slates.list(caller, { include_archived: true }), slates.activity(caller, 200)]);
    const body = JSON.stringify({ exported_at: new Date().toISOString(), slates: all, activity }, null, 2);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="slates-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
