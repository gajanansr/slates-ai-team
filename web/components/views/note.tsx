import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Note, SlateKind } from '@/lib/kinds';
import { NavBar } from '@/components/slate/nav-bar';
import { PageTransition } from '@/components/page-transition';
import { NoteBody } from '@/components/notes/note-body';
import { NoteEditor } from '@/components/notes/note-editor';
import { BoardIcon } from '@/components/board-icon';
import { Ago } from '@/components/time';
import { TellAgents, type Told } from '@/components/desk/tell-agents';
import { ABOUT_ID } from '@/lib/about-id';

type Linked = { slug: string; title: string; icon: string | null; kind: SlateKind };

export function NoteView({ note, linkedFrom, edit, urls = {}, told, shortcut = false, embeds = {}, boards = [] }: { note: Note; linkedFrom: Linked[]; edit?: boolean; urls?: Record<string, string>; told?: Told[]; shortcut?: boolean; embeds?: Record<string, React.ReactNode>; boards?: { slug: string; title: string }[] }) {
  const isAbout = note.id === ABOUT_ID;
  return (
    <PageTransition>
      <NavBar title={note.title} backHref="/notes" backLabel="Back to notes">
        <header className="note-head mb-4">
          <p className="kicker mb-1.5">
            {isAbout ? 'Shared memory' : 'Note'}
            {note.tags?.length ? ` · ${note.tags.join(' · ')}` : ''}
            {note.updated_at && (
              <>
                {' · '}
                <Ago iso={note.updated_at} />
                {note.by ? ` by ${note.by}` : ''}
              </>
            )}
          </p>
          <h1 className="text-[26px] font-medium leading-[1.15] tracking-[-0.04em] md:text-[32px]">{note.title}</h1>
        </header>
      </NavBar>

      {isAbout && (
        <p className="sage-card mb-4 p-3.5 text-[14px] leading-snug text-fg-2">
          Every agent you connect reads this first. Tell one assistant something and the others know it too. Edit it any time.
        </p>
      )}
      <section className="card p-4 sm:p-6">
        <NoteEditor note={note} startEditing={edit} shortcut={shortcut} boards={boards} urls={urls}>
          <NoteBody id={note.id} body={note.body} urls={urls} embeds={embeds} />
        </NoteEditor>
      </section>

      {told && <TellAgents target={{ type: 'note', id: note.id, title: note.title }} path={`/notes/${note.id}`} told={told} />}

      {linkedFrom.length > 0 && (
        <section className="mt-6">
          <h2 className="kicker mb-2 px-1">Linked from</h2>
          <ul className="card divide-y divide-line">
            {linkedFrom.map((s) => (
              <li key={s.slug}>
                <Link href={`/s/${s.slug}`} className="flex items-center gap-3 px-4 py-3.5">
                  <BoardIcon name={s.icon} kind={s.kind} className="size-4 text-fg-3" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{s.title}</span>
                  <ChevronRight className="size-4 text-fg-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageTransition>
  );
}
