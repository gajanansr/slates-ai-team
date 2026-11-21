import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { notesOf, getBoard } from '@/lib/notes';
import type { DashboardDataT } from '@/lib/kinds';
import { NoteView } from '@/components/views/note';
import { attPaths } from '@/lib/note-media';
import { noteEmbeds } from '@/components/notes/note-embeds';
import { isSpaceBoard } from '@/lib/spaces';
import { parseLayout } from '@/lib/app-layout';
import { signedUrls } from '@/lib/files';
import { desk, toldAbout } from '@/lib/desk';

async function load(id: string) {
  const caller = { client: await supabaseServer(), token: null };
  const [board, all, onDesk, { data: settings }] = await Promise.all([getBoard(caller), slates.list(caller), desk.list(caller).catch(() => []), caller.client.from('user_settings').select('app_layout').maybeSingle()]);
  const note = notesOf(board).find((n) => n.id === id);
  if (!note) notFound();
  // Dashboards that link to this note.
  const linkedFrom = all
    .filter((s) => s.kind === 'dashboard' && ((s.data as DashboardDataT).widgets ?? []).some((w) => w.kind === 'note' && w.data.note === id))
    .map((s) => ({ slug: s.slug, title: s.title, icon: s.icon, kind: s.kind }));
  const urls = await signedUrls(caller.client, attPaths(note.body)).catch(() => ({}));
  const shortcut = (parseLayout(settings?.app_layout).pins ?? []).some((p) => p.type === 'note' && p.id === id);
  return { note, linkedFrom, urls, shortcut, embeds: noteEmbeds(note.body, all), boards: all.filter(isSpaceBoard).map((b) => ({ slug: b.slug, title: b.title })), told: toldAbout(onDesk, 'note', id) };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return { title: (await load(decodeURIComponent(id))).note.title };
  } catch {
    return { title: 'Note' };
  }
}

export default async function NotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const { note, linkedFrom, urls, told, shortcut, embeds, boards } = await load(decodeURIComponent(id));
  return <NoteView note={note} linkedFrom={linkedFrom} urls={urls} told={told} shortcut={shortcut} embeds={embeds} boards={boards} edit={edit === '1'} />;
}
