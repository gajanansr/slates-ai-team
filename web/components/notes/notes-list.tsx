'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Pin, Search, X } from 'lucide-react';
import { useViewMode, ViewToggle, type ViewMode } from '@/components/ui/view-toggle';
import type { Note } from '@/lib/kinds';
import { notePath } from '@/lib/notes-shared';
import { Ago } from '@/components/time';

/** Searchable list of notes with tag chips. Pinned first, then newest. */
export function NotesList({ items, view = 'cards' }: { items: Note[]; view?: ViewMode }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [mode, setMode] = useViewMode('notes', view);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of items) for (const t of n.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [items]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items
      .filter((n) => !tag || n.tags?.includes(tag))
      .filter((n) => !t || `${n.title}\n${n.tags?.join(' ') ?? ''}\n${n.body}`.toLowerCase().includes(t));
  }, [items, q, tag]);
  const pinned = list.filter((n) => n.pinned);
  const others = list.filter((n) => !n.pinned);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
      <label className="relative block min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={1.75} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          enterKeyHint="search"
          className="field pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-fg-3 active:bg-muted">
            <X className="size-4" />
          </button>
        )}
      </label>
      <ViewToggle mode={mode} onChange={setMode} />
      </div>

      {tags.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          {[null, ...tags].map((t) => {
            const active = tag === t;
            return (
              <button
                key={t ?? 'all'}
                type="button"
                onClick={() => setTag(t)}
                aria-pressed={active}
                className={`h-8 shrink-0 rounded-full px-3.5 text-[13px] transition-colors active:scale-95 ${
                  active ? 'bg-btn text-on-btn' : 'bg-surface text-fg-2 shadow-[var(--shadow-card)]'
                }`}
              >
                {t ?? 'All'}
              </button>
            );
          })}
        </div>
      )}

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-3">{items.length ? 'No notes match.' : 'No notes yet.'}</p>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <h2 className="kicker mb-2 px-1">Pinned</h2>
              <Notes notes={pinned} mode={mode} />
              {others.length > 0 && <h2 className="kicker mb-2 mt-5 px-1">Others</h2>}
            </>
          )}
          <Notes notes={others} mode={mode} />
        </>
      )}
    </>
  );
}

function Notes({ notes, mode }: { notes: Note[]; mode: ViewMode }) {
  if (mode === 'list')
    return (
      <ul className="card divide-y divide-line overflow-hidden">
        {notes.map((n, i) => (
          <li key={n.id} className="enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
            <NoteListRow n={n} />
          </li>
        ))}
      </ul>
    );
  return (
    <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
      {notes.map((n, i) => (
        <li key={n.id} className="enter flex min-w-0" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
          <NoteCard n={n} />
        </li>
      ))}
    </ul>
  );
}

/** The note's first line of text that isn't just its title again. */
function preview(n: Note, max: number) {
  const t = n.title.trim().toLowerCase();
  const lines = n.body.split('\n').filter((l) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l)).map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).filter((l) => l && !l.toLowerCase().startsWith(t.slice(0, 24)));
  const s = lines.join(' · ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A short card: the title (two lines at most) and when. Tags live in the filter chips above. */
export function NoteCard({ n }: { n: Note }) {
  return (
    <Link href={notePath(n.id)} transitionTypes={['nav-forward']} className="card press flex h-full min-h-[96px] w-full flex-col p-3.5">
      <span className="flex items-start gap-1.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-[15px] font-medium leading-snug tracking-[-0.015em] [overflow-wrap:anywhere]">{n.title}</span>
        {n.pinned && <Pin className="mt-0.5 size-3.5 flex-none text-fg-3" strokeWidth={1.75} aria-label="Pinned" />}
      </span>
      {n.updated_at && (
        <span className="mt-auto pt-2 text-[12px] text-fg-4">
          <Ago iso={n.updated_at} />
        </span>
      )}
    </Link>
  );
}

function NoteListRow({ n }: { n: Note }) {
  const line = preview(n, 80);
  return (
    <Link href={notePath(n.id)} transitionTypes={['nav-forward']} className="flex items-center gap-3 px-4 py-3 active:bg-muted">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-medium">{n.title}</span>
          {n.pinned && <Pin className="size-3 flex-none text-fg-3" strokeWidth={2} aria-label="Pinned" />}
        </span>
        <span className="block truncate text-[13px] text-fg-3">{line || 'Empty note'}</span>
      </span>
      {n.updated_at && (
        <span className="flex-none text-[11.5px] text-fg-4">
          <Ago iso={n.updated_at} />
        </span>
      )}
    </Link>
  );
}
