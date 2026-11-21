'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { BoardIcon } from '@/components/board-icon';
import { RestoreButton } from '@/components/settings-client';
import { Ago } from '@/components/time';

type Row = { slug: string; title: string; kind: string; icon: string | null; at: string | null };
const PAGE = 20;

/** Hidden and archived boards: two tabs, search, and 20 at a time instead of one endless list. */
export function HiddenBoards({ tab: initial, hidden, archived }: { tab: 'hidden' | 'archived'; hidden: Row[]; archived: Row[] }) {
  const [tab, setTab] = useState(initial);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const rows = tab === 'hidden' ? hidden : archived;
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => r.title.toLowerCase().includes(t) || r.slug.includes(t)) : rows;
  }, [rows, q]);

  return (
    <div className="rise-2 space-y-4">
      <div role="tablist" aria-label="Which boards" className="grid grid-cols-2 gap-1 rounded-[18px] bg-muted p-1">
        {(['hidden', 'archived'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setShown(PAGE);
            }}
            className={`flex h-10 items-center justify-center gap-2 rounded-[14px] text-[14px] font-medium ${tab === t ? 'bg-surface text-fg shadow-[var(--shadow-card)]' : 'text-fg-3'}`}
          >
            {t === 'hidden' ? 'Hidden' : 'Archived'}
            <span className="tabular text-fg-4">{t === 'hidden' ? hidden.length : archived.length}</span>
          </button>
        ))}
      </div>

      {rows.length > 8 && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={1.75} />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder={`Search ${tab} boards`} aria-label="Search" className="field pl-11" />
        </label>
      )}

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-3">{rows.length ? 'No boards match.' : tab === 'hidden' ? 'No hidden boards.' : 'Nothing archived.'}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {list.slice(0, shown).map((s) => (
            <li key={s.slug} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted">
                <BoardIcon name={s.icon} kind={s.kind as never} className="size-4 text-fg-3" />
              </span>
              <Link href={`/s/${s.slug}`} className="min-w-0 flex-1">
                <p className="truncate text-[15px]">{s.title}</p>
                <p className="truncate text-xs text-fg-3">
                  {s.kind}
                  {s.at && (
                    <>
                      {' · '}
                      {tab === 'archived' ? 'archived ' : 'updated '}
                      <Ago iso={s.at} />
                    </>
                  )}
                </p>
              </Link>
              <RestoreButton slug={s.slug} kind={tab} />
            </li>
          ))}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE)} className="btn btn-glass w-full">
          Show {Math.min(PAGE, list.length - shown)} more · {list.length - shown} left
        </button>
      )}
    </div>
  );
}
