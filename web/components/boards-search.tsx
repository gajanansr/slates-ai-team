'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, LayoutDashboard, Search, X } from 'lucide-react';
import { BoardRow, BoardTile } from '@/components/slate/board-tile';
import { useViewMode, ViewToggle } from '@/components/ui/view-toggle';
import type { Slate } from '@/lib/kinds';
import { categoryOf, categorySlug } from '@/lib/summary';

type Sort = 'recent' | 'name' | 'category';
const SORTS: [Sort, string][] = [
  ['recent', 'Recent'],
  ['name', 'Name'],
  ['category', 'Category'],
];
const KEY = 'slates-boards-sort';

/**
 * All boards as one compact grid (BUG-02): pinned first, then by the chosen sort.
 * "Category" groups into sections; a selected category offers its dashboard view.
 */
export function BoardsSearch({ boards, category, view = 'cards' }: { boards: Slate[]; category?: { slug: string; name: string }; view?: 'cards' | 'list' }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [mode, setMode] = useViewMode('boards', view);
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'name' || v === 'category' || v === 'recent') setSort(v);
    } catch {}
  }, []);
  const choose = (s: Sort) => {
    setSort(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {}
  };

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = t ? boards.filter((b) => [b.title, b.kind, categoryOf(b), b.slug].some((f) => f.toLowerCase().includes(t))) : boards;
    const by = {
      recent: (a: Slate, b: Slate) => b.updated_at.localeCompare(a.updated_at),
      name: (a: Slate, b: Slate) => a.title.localeCompare(b.title),
      category: (a: Slate, b: Slate) => categoryOf(a).localeCompare(categoryOf(b)) || a.title.localeCompare(b.title),
    }[sort];
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || by(a, b));
  }, [q, boards, sort]);

  const sections = useMemo(() => {
    if (sort !== 'category' || category) return null;
    const m = new Map<string, Slate[]>();
    for (const b of list) m.set(categoryOf(b), [...(m.get(categoryOf(b)) ?? []), b]);
    return [...m.entries()];
  }, [list, sort, category]);

  return (
    <>
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={1.75} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search boards"
          aria-label="Search boards"
          enterKeyHint="search"
          className="field pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-fg-3 active:bg-muted">
            <X className="size-4" />
          </button>
        )}
      </label>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Sort boards" className="flex gap-1 rounded-full bg-muted p-1">
          {SORTS.filter(([s]) => !(category && s === 'category')).map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sort === s}
              onClick={() => choose(s)}
              className={`h-8 rounded-full px-3 text-[13px] font-medium transition-colors ${sort === s ? 'bg-surface text-fg shadow-[var(--shadow-card)]' : 'text-fg-3'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
        {category && (
          <Link href={`/boards/${category.slug}`} transitionTypes={['nav-forward']} className="btn btn-primary h-9 px-3.5 text-[13px]">
            <LayoutDashboard className="size-4" strokeWidth={1.75} /> Open as dashboard
          </Link>
        )}
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-3">{q ? <>No boards match &ldquo;{q}&rdquo;.</> : 'No boards here yet.'}</p>
      ) : sections ? (
        <div className="space-y-6">
          {sections.map(([name, items]) => (
            <section key={name}>
              <Link href={`/boards/${categorySlug(name)}`} transitionTypes={['nav-forward']} className="mb-2.5 flex items-center justify-between rounded-xl px-1 py-0.5 active:bg-muted">
                <h2 className="text-[20px] font-medium tracking-[-0.03em]">{name}</h2>
                <span className="flex items-center gap-1 text-[13px] text-fg-3">
                  {items.length > 1 ? 'Dashboard' : items.length}
                  <ChevronRight className="size-4" />
                </span>
              </Link>
              <Boards items={items} mode={mode} />
            </section>
          ))}
        </div>
      ) : (
        <Boards items={list} mode={mode} />
      )}
    </>
  );
}

function Boards({ items, mode }: { items: Slate[]; mode: 'cards' | 'list' }) {
  if (mode === 'list')
    return (
      <ul className="card divide-y divide-line overflow-hidden">
        {items.map((s, i) => (
          <li key={s.id} className="enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
            <BoardRow slate={s} />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((s, i) => (
        <div key={s.id} className="enter flex min-w-0" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
          <BoardTile slate={s} />
        </div>
      ))}
    </div>
  );
}
