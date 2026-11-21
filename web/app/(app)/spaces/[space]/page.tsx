import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { slates as svc } from '@/lib/slates';
import { getBoard, notesOf, sortNotes } from '@/lib/notes';
import { spacesOf } from '@/lib/spaces';
import { NavBar } from '@/components/slate/nav-bar';
import { PageTransition } from '@/components/page-transition';
import { Bento, metricBlocks, type Block } from '@/components/bento';
import { NoteCard } from '@/components/notes/notes-list';

export const metadata = { title: 'Space' };

/** One space: its numbers and boards laid out together, then its notes. */
export default async function SpacePage({ params }: { params: Promise<{ space: string }> }) {
  const { space } = await params;
  const caller = { client: await supabaseServer(), token: null };
  const [all, board] = await Promise.all([svc.list(caller), getBoard(caller).catch(() => null)]);
  const sp = spacesOf(all, notesOf(board)).find((g) => g.slug === decodeURIComponent(space));
  if (!sp) notFound();
  // Numbers and charts first, the way a dashboard reads.
  const order = (k: string) => (k === 'metrics' ? 0 : k === 'chart' ? 1 : k === 'dashboard' ? 2 : 3);
  const boards = [...sp.boards].sort((a, b) => order(a.kind) - order(b.kind));
  let featured = false;
  const blocks: Block[] = boards.flatMap((s): Block[] => {
    if (s.kind === 'metrics') {
      const out = metricBlocks(s.id, ((s.data as any).items ?? []) as any[], { group: s.title, featureFirst: !featured });
      featured = true;
      return out;
    }
    return [{ type: 'widget', key: s.id, title: s.title, kind: s.kind, data: s.data, slate: s, mode: s.kind === 'chart' ? 'full' : 'card', href: `/s/${s.slug}`, icon: { name: s.icon, kind: s.kind } }];
  });
  const notes = sortNotes(sp.notes);

  return (
    <PageTransition>
      <NavBar title={sp.name} backHref="/spaces" backLabel="Back to spaces">
        <header className="mb-5">
          <p className="kicker mb-2">
            {boards.length} board{boards.length === 1 ? '' : 's'}
            {notes.length > 0 && ` · ${notes.length} note${notes.length === 1 ? '' : 's'}`}
          </p>
          <h1 className="text-[30px] font-medium leading-[1.1] tracking-[-0.045em]">{sp.name}</h1>
        </header>
      </NavBar>
      <Bento blocks={blocks} />
      {notes.length > 0 && (
        <section className="mt-6" aria-labelledby="space-notes">
          <h2 id="space-notes" className="mb-2 px-0.5 text-[19px] font-medium tracking-[-0.035em]">Notes</h2>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {notes.map((n) => (
              <li key={n.id}>
                <NoteCard n={n} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageTransition>
  );
}
