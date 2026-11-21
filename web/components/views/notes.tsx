import type { Note } from '@/lib/kinds';
import { NavBar } from '@/components/slate/nav-bar';
import { PageTransition } from '@/components/page-transition';
import { IllustrationPanel } from '@/components/illustrations';
import { NotesList } from '@/components/notes/notes-list';
import { NewNoteButton } from '@/components/notes/new-note';
import { QuickNote } from '@/components/notes/quick-note';

/** The Notes tab: every note you and your agents wrote, in one place. */
export function NotesView({ items, view = 'cards' }: { items: Note[]; view?: 'cards' | 'list' }) {
  const tags = new Set(items.flatMap((n) => n.tags ?? [])).size;
  return (
    <PageTransition>
      <NavBar title="Notes" actions={<NewNoteButton />} backHref="/spaces" backLabel="Back to spaces">
        <header className="mb-4">
          <p className="kicker mb-2">
            {items.length} {items.length === 1 ? 'note' : 'notes'}
            {tags ? ` · ${tags} ${tags === 1 ? 'tag' : 'tags'}` : ''}
          </p>
          <h1 className="text-[32px] font-medium leading-[1.1] tracking-[-0.045em] md:text-[36px]">Everything written down.</h1>
        </header>
      </NavBar>
      <QuickNote />
      {items.length === 0 ? (
        <div className="card p-4 text-center">
          <IllustrationPanel name="page" className="mb-4 h-[150px]" />
          <p className="text-[17px] font-medium tracking-tight">No notes yet</p>
          <p className="mx-auto mt-1 max-w-[36ch] pb-2 text-sm text-fg-3">Ask an agent to “add a note”, or tap + to write one. Dashboards can link to any note.</p>
        </div>
      ) : (
        <NotesList items={items} view={view} />
      )}
    </PageTransition>
  );
}
