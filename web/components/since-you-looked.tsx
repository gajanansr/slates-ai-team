'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Zap } from 'lucide-react';
import { BoardIcon } from '@/components/board-icon';
import { Ago } from '@/components/time';
import { markOpened, readOpened } from '@/components/opened';
import type { SlateKind } from '@/lib/kinds';

/** Today shows the newest few; the rest are one tap away in Activity. */
const MAX_ROWS = 3;
export type SinceRow = { key: string; href: string; icon: { name: string | null; kind: SlateKind } | 'auto'; title: string; sub: string; at: string };

/**
 * What changed while you were away. Each row clears when you open it (not when you leave Home);
 * once every row is opened, the server's "last looked" moves forward too.
 */
export function SinceYouLooked({ rows, last }: { rows: SinceRow[]; last: { who: string; what: string; at: string } | null }) {
  const [opened, setOpened] = useState<Record<string, number> | null>(null);
  const advanced = useRef(false);
  useEffect(() => setOpened(readOpened()), []);
  const fresh = opened ? rows.filter((r) => !(opened[r.key] && opened[r.key] >= new Date(r.at).getTime())) : rows;

  // Everything listed has been opened: move the server's marker so the list starts fresh.
  useEffect(() => {
    if (opened && rows.length > 0 && fresh.length === 0 && !advanced.current) {
      advanced.current = true;
      navigator.sendBeacon?.('/api/seen');
    }
  }, [opened, rows.length, fresh.length]);

  const clearAll = () => {
    markOpened(rows.map((r) => r.key));
    setOpened(readOpened());
  };

  return (
    <section className="rise-3 md:mt-2" aria-labelledby="since-h">
      <div className="mb-2 flex flex-none items-center justify-between gap-3 px-0.5">
        <h2 id="since-h" className="flex min-w-0 items-center gap-2 text-[19px] font-medium tracking-[-0.035em]">
          <span className="truncate">What changed</span>
          {fresh.length > 0 && (
            <span className="flex flex-none items-center gap-1.5 rounded-full bg-new/15 px-2 py-0.5 text-[12px] font-semibold tracking-normal text-new">
              <span className="size-1.5 rounded-full bg-new" />
              {fresh.length} new
            </span>
          )}
        </h2>
        {fresh.length > 0 ? (
          <button type="button" onClick={clearAll} className="flex-none py-2 text-[13.5px] font-medium text-fg-3">
            Mark seen
          </button>
        ) : (
          <Link href="/activity" className="flex-none py-2 text-[14px] font-medium text-fg-2">
            Activity
          </Link>
        )}
      </div>
      {fresh.length > 0 ? (
        <ul className="card divide-y divide-line">
          {fresh.slice(0, MAX_ROWS).map((r) => (
            <li key={r.key}>
              <Link href={r.href} onClick={() => markOpened([r.key])} transitionTypes={['nav-forward']} className="flex items-center gap-3 px-3.5 py-2.5 active:bg-muted">
                <span className="relative grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2">
                  {r.icon === 'auto' ? <Zap className="size-4" strokeWidth={1.8} /> : <BoardIcon name={r.icon.name} kind={r.icon.kind} className="size-4" />}
                  <span aria-label="New" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--surface)] bg-new" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium">{r.title}</span>
                  <span className="block truncate text-[12px] text-fg-3">
                    {r.sub} · <Ago iso={r.at} />
                  </span>
                </span>
                <ChevronRight className="size-4 flex-none text-fg-4" />
              </Link>
            </li>
          ))}
          {fresh.length > MAX_ROWS && (
            <li>
              <Link href="/activity" className="flex items-center gap-3 px-3.5 py-2.5 text-[13.5px] font-medium text-fg-2 active:bg-muted">
                <span className="min-w-0 flex-1">{fresh.length - MAX_ROWS} more in Activity</span>
                <ChevronRight className="size-4 flex-none text-fg-4" />
              </Link>
            </li>
          )}
        </ul>
      ) : (
        <div className="card flex flex-none items-center gap-3 px-3.5 py-2.5">
          <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-3">
            <Check className="size-4" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium">All caught up</span>
            <span className="block truncate text-[12px] text-fg-3">
              {last ? (
                <>
                  Last: {last.who} {last.what} · <Ago iso={last.at} />
                </>
              ) : (
                'Changes from your agents and automations show up here.'
              )}
            </span>
          </span>
        </div>
      )}
    </section>
  );
}
