import Link from 'next/link';
import { Pin } from 'lucide-react';
import { BoardIcon } from '@/components/board-icon';
import type { Slate } from '@/lib/kinds';
import { isFresh, summarize } from '@/lib/summary';
import { Ago } from '@/components/time';
import { fitNumber } from '@/lib/fit-number';
import { TileViz } from '@/components/slate/tile-viz';

/** One colour family per kind, so a glance tells boards apart. */
const KIND_TINT: Record<string, string> = {
  list: 'var(--tint-2)',
  tracker: 'var(--tint-3)',
  habits: 'var(--tint-2)',
  goals: 'var(--tint-1)',
  countdown: 'var(--tint-4)',
  money: 'var(--tint-1)',
  chart: 'var(--tint-3)',
  table: 'var(--tint-5)',
  dashboard: 'var(--tint-3)',
  links: 'var(--tint-5)',
  markdown: 'var(--tint-5)',
};

/** Done share for list-like boards (items with `done`), to draw a progress line. */
function progress(s: Slate): number | null {
  const items = (s.data as { items?: { done?: boolean }[] } | null)?.items;
  if (!Array.isArray(items) || items.length < 2 || !items.some((i) => typeof i?.done === 'boolean')) return null;
  return items.filter((i) => i.done).length / items.length;
}

/**
 * A board card: icon, name, and one number with a few words. Sized by its content (never a
 * fixed height that text can overflow); a row of cards stretches to match its tallest.
 */
export function BoardTile({ slate }: { slate: Slate }) {
  const { stat, label } = summarize(slate);
  const fresh = isFresh(slate);
  const p = progress(slate);
  // Keep the caption short: just the first part ("Salary · 9 widgets" -> "Salary").
  const caption = label.split(' · ')[0];
  return (
    <Link
      href={`/s/${slate.slug}`}
      transitionTypes={['nav-forward']}
      className="card press relative flex h-full min-h-[136px] w-full min-w-0 flex-col p-3.5"
      aria-label={`${slate.title}${stat ? `, ${stat} ${label}` : ''}${fresh ? ', updated recently' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="relative grid size-9 flex-none place-items-center rounded-xl text-fg" style={{ background: KIND_TINT[slate.kind] ?? 'var(--muted)' }}>
          <BoardIcon name={slate.icon} kind={slate.kind} className="size-4" />
          {fresh && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-[var(--surface)] bg-new" />}
        </span>
        {slate.pinned && <Pin className="mt-1 size-3.5 text-fg-4" strokeWidth={2} aria-hidden />}
      </div>
      <p className="mt-2 truncate text-[15px] font-medium leading-snug tracking-[-0.015em]">{slate.title}</p>
      <div className="mt-2 min-w-0 empty:hidden">
        <TileViz slate={slate} />
      </div>
      <div className="mt-auto min-w-0 pt-2">
        {stat ? (
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span data-sensitive className="tabular flex-none whitespace-nowrap font-medium leading-tight tracking-[-0.035em]" style={{ fontSize: fitNumber(stat, 20) }}>
              {stat}
            </span>
            {caption && stat.length < 9 && <span className="min-w-0 truncate text-[12px] text-fg-3">{caption}</span>}
          </p>
        ) : (
          <p className="truncate text-[12.5px] text-fg-3">
            <Ago iso={slate.updated_at} />
          </p>
        )}
        {p !== null && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-fg" style={{ width: `${Math.round(p * 100)}%` }} />
          </span>
        )}
      </div>
    </Link>
  );
}

/** The list version: one line per board. */
export function BoardRow({ slate }: { slate: Slate }) {
  const { stat, label } = summarize(slate);
  const fresh = isFresh(slate);
  return (
    <Link href={`/s/${slate.slug}`} transitionTypes={['nav-forward']} className="flex items-center gap-3 px-3.5 py-2.5 active:bg-muted">
      <span className="relative grid size-9 flex-none place-items-center rounded-xl text-fg" style={{ background: KIND_TINT[slate.kind] ?? 'var(--muted)' }}>
        <BoardIcon name={slate.icon} kind={slate.kind} className="size-4" />
        {fresh && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[var(--surface)] bg-new" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-medium">{slate.title}</span>
          {slate.pinned && <Pin className="size-3 flex-none text-fg-4" strokeWidth={2} aria-hidden />}
        </span>
        <span className="block truncate text-[12.5px] text-fg-3">
          {stat ? (
            <>
              <span data-sensitive className="tabular text-fg-2">
                {stat}
              </span>{' '}
              {label}
            </>
          ) : (
            label
          )}
        </span>
      </span>
      <span className="flex-none text-[11.5px] text-fg-4">
        <Ago iso={slate.updated_at} />
      </span>
    </Link>
  );
}
