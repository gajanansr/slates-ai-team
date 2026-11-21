import { supabaseServer } from '@/lib/supabase/server';
import { toSlatesError } from '@/lib/slates';
import { notes } from '@/lib/notes';
import { noteMarkdown } from '@/lib/note-media';

export const dynamic = 'force-dynamic';

/** Every note as one Markdown file, pinned first then newest (session cookie auth). */
export async function GET() {
  try {
    const client = await supabaseServer();
    const { data } = await client.auth.getUser();
    if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
    const all = await notes.list({ client, token: null });
    const body = all.map(noteMarkdown).join('\n\n---\n\n');
    return new Response(body || 'No notes yet.\n', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="slates-notes-${new Date().toISOString().slice(0, 10)}.md"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
