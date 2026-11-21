import { supabaseServer } from '@/lib/supabase/server';
import { notes } from '@/lib/notes';
import { NotesView } from '@/components/views/notes';
import { viewMode } from '@/lib/view-mode';

export const metadata = { title: 'Notes' };

export default async function NotesPage() {
  const [items, view] = await Promise.all([notes.list({ client: await supabaseServer(), token: null }), viewMode('notes')]);
  return <NotesView items={items} view={view} />;
}
