import Link from 'next/link';
import { ArrowUpRight, ChevronRight, NotebookPen } from 'lucide-react';
import type { Note, Slate } from '@/lib/kinds';
import { notePath, snippet } from '@/lib/notes-shared';
import { LinksView, ListView, MarkdownView, TableView, TimelineView } from '@/components/slate/kinds';
import { Chart, Sparkline } from '@/components/charts/chart';
import { BoardIcon } from '@/components/board-icon';
import { CountdownWidget, GoalsWidget, HabitsWidget, ListProgress, TrackerWidget } from '@/components/slate/widget-visuals';
import { Ago } from '@/components/time';

export type Metric = { id: string; label: string; value: string; sub?: string; tone?: string; progress?: number; trend?: number[]; href?: string };
export type Freshness = { source?: string; as_of?: string; stale_after_hours?: number };

export type Block =
  | ({ type: 'metric'; key: string; m: Metric; group?: string; feature?: boolean; headerHref?: string; span?: string } & Freshness)
  | { type: 'section'; key: string; title: string }
  | ({ type: 'widget'; key: string; title: string; kind: string; data: any; slate: Slate; widgetId?: string; width?: 'full' | 'half'; size?: 's' | 'm' | 'l' | 'xl'; view?: 'auto' | 'ring' | 'bars' | 'heatmap' | 'dots' | 'compact'; look?: 'cards' | 'compact' | 'focus'; mode: 'card' | 'full'; href?: string; icon?: { name: string | null; kind: Slate['kind'] } } & Freshness);

const SPAN: Record<string, string> = {
  chart: 'col-span-2 md:col-span-2',
  table: 'col-span-2 md:col-span-4',
  list: 'col-span-2 md:col-span-2',
  links: 'col-span-2 md:col-span-2',
  timeline: 'col-span-2 md:col-span-2',
  markdown: 'col-span-2 md:col-span-2',
  note: 'col-span-2 md:col-span-2',
  goals: 'col-span-2 md:col-span-2',
  countdown: 'col-span-2 md:col-span-2',
  tracker: 'col-span-2 md:col-span-4',
  habits: 'col-span-2 md:col-span-2',
  dashboard: 'col-span-2 md:col-span-4',
};

function Fresh({ source, as_of, stale_after_hours, dark }: Freshness & { dark?: boolean }) {
  if (!source && !as_of) return null;
  const stale = as_of && stale_after_hours ? Date.now() - new Date(as_of).getTime() > stale_after_hours * 3_600_000 : false;
  return (
    <p className={`mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] ${dark ? 'text-on-hero-2' : 'text-fg-3'}`}>
      {stale && <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-on-accent">Stale</span>}
      {source && <span>{source}</span>}
      {source && as_of && <span aria-hidden>·</span>}
      {as_of && (
        <span>
          checked <Ago iso={as_of} />
        </span>
      )}
    </p>
  );
}

function MetricTile({ b }: { b: Extract<Block, { type: 'metric' }> }) {
  const { m } = b;
  const tone = b.feature ? 'hero' : m.tone === 'bad' ? 'bg-accent text-on-accent' : m.tone === 'good' ? 'sage-card' : 'card';
  const body = (
    <>
      {b.group && <p className={`kicker mb-2 ${b.feature ? '!text-on-hero-2' : ''}`}>{b.group}</p>}
      <p className={`text-[13px] leading-snug ${b.feature ? 'text-on-hero-2' : m.tone === 'bad' ? 'text-on-accent/70' : 'text-fg-3'}`}>{m.label}</p>
      <p
        data-sensitive
        className={`tabular mt-1 break-words font-medium leading-[1.1] tracking-[-0.04em] [overflow-wrap:anywhere] ${b.feature ? 'text-[34px]' : 'line-clamp-2 text-[24px]'}`}
      >
        {m.value}
      </p>
      {m.sub && <p className={`mt-1 line-clamp-3 text-[12.5px] leading-snug ${b.feature ? 'text-on-hero-2' : 'opacity-70'}`}>{m.sub}</p>}
      {typeof m.progress === 'number' && (
        <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${b.feature ? 'bg-white/10' : 'bg-black/[0.07]'}`}>
          <div className={`h-full rounded-full ${b.feature ? 'bg-accent' : 'bg-current'}`} style={{ width: `${m.progress}%` }} />
        </div>
      )}
      {m.trend && m.trend.length > 1 && <Sparkline values={m.trend} className="mt-3" />}
      <Fresh source={b.source} as_of={b.as_of} stale_after_hours={b.stale_after_hours} dark={b.feature} />
      {m.href && <ArrowUpRight className="absolute right-3.5 top-3.5 size-4 opacity-60" aria-hidden />}
    </>
  );
  const cls = `relative min-w-0 rounded-[24px] p-4 ${tone} ${b.span ?? (b.feature ? 'col-span-2' : 'col-span-1')}`;
  return m.href ? (
    <a href={m.href} target="_blank" rel="noopener noreferrer" className={`${cls} transition-transform active:scale-[0.98]`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function WidgetBody({ b }: { b: Extract<Block, { type: 'widget' }> }) {
  const props = { slate: b.slate, data: b.data, mode: b.mode, widgetId: b.widgetId };
  switch (b.kind) {
    case 'chart':
      return <Chart data={b.data} mode={b.mode === 'full' ? 'full' : 'card'} />;
    case 'list':
      return (
        <>
          {b.look !== 'compact' && b.view !== 'compact' && <ListProgress items={b.data?.items ?? []} />}
          <ListView {...props} />
        </>
      );
    case 'table':
      return <TableView {...props} />;
    case 'links':
      return <LinksView {...props} />;
    case 'timeline':
      return <TimelineView {...props} />;
    case 'markdown':
      return <MarkdownView {...props} />;
    case 'goals':
      return <GoalsWidget {...props} view={b.view} />;
    case 'countdown':
      return <CountdownWidget {...props} view={b.view} />;
    case 'tracker':
      // Per-stage counts; the full board is where cards move.
      return <TrackerWidget {...props} view={b.view} />;
    case 'habits':
      return <HabitsWidget data={b.data} view={b.view} />;
    case 'dashboard': {
      const ws = (b.data?.widgets ?? []) as { title: string }[];
      return (
        <p className="text-[14px] leading-relaxed text-fg-2">
          {b.data?.summary ? `${b.data.summary} · ` : ''}
          {ws.length} widgets: {ws.slice(0, 4).map((w) => w.title).join(', ')}
          {ws.length > 4 ? '…' : ''}
        </p>
      );
    }
    default:
      return null;
  }
}

/** A dashboard's link to a note: title, first line, last edit. The whole card opens the note. */
function NoteTile({ b, span }: { b: Extract<Block, { type: 'widget' }>; span: string }) {
  const n = b.data?.resolved as Note | undefined;
  if (!n) {
    return (
      <section className={`card min-w-0 p-4 ${span}`}>
        <div className="mb-2 flex items-center gap-2">
          <NotebookPen className="size-4 text-fg-3" strokeWidth={1.6} />
          <h3 className="min-w-0 flex-1 truncate text-[15.5px] font-medium tracking-[-0.02em]">{b.title}</h3>
        </div>
        <p className="text-[14px] text-fg-3">This note was deleted or hasn&apos;t been written yet.</p>
      </section>
    );
  }
  const line = snippet(n.body, 220);
  return (
    <Link href={notePath(n.id)} transitionTypes={['nav-forward']} className={`card group min-w-0 p-4 transition-transform active:scale-[0.99] ${span}`}>
      <span className="mb-2 flex items-center gap-2">
        <NotebookPen className="size-4 text-fg-3" strokeWidth={1.6} />
        <span className="min-w-0 flex-1 truncate text-[15.5px] font-medium tracking-[-0.02em]">{b.title}</span>
        <ChevronRight className="size-4 text-fg-4" />
      </span>
      {b.title.trim().toLowerCase() !== n.title.trim().toLowerCase() && <span className="block text-[14.5px] font-medium">{n.title}</span>}
      <span className="mt-0.5 line-clamp-3 block text-[14px] leading-relaxed text-fg-3">{line || 'Empty note'}</span>
      {n.updated_at && (
        <span className="mt-2.5 block text-[12px] text-fg-4">
          Edited <Ago iso={n.updated_at} />
          {n.by ? ` · ${n.by}` : ''}
        </span>
      )}
    </Link>
  );
}

const SIZE_SPAN = { s: 'col-span-1 md:col-span-1', m: 'col-span-2 md:col-span-2', l: 'col-span-2 md:col-span-3', xl: 'col-span-2 md:col-span-4' } as const;

/** A quiet icon per kind so cards read at a glance. */
const KIND_GLYPH: Record<string, string> = { goals: '◎', habits: '↻', countdown: '⏳', tracker: '▤', list: '☑', chart: '▲', table: '▦', links: '↗', timeline: '┃', markdown: '¶' };

function WidgetTile({ b }: { b: Extract<Block, { type: 'widget' }> }) {
  const span = b.size ? SIZE_SPAN[b.size] : b.width === 'full' ? 'col-span-2 md:col-span-4' : b.width === 'half' && b.kind !== 'chart' ? 'col-span-2 md:col-span-2' : SPAN[b.kind] ?? 'col-span-2';
  const pad = b.look === 'compact' ? 'p-3' : 'p-4';
  if (b.kind === 'note') return <NoteTile b={b} span={span} />;
  const head = (
    <>
      {b.icon && <BoardIcon name={b.icon.name} kind={b.icon.kind} className="size-4 text-fg-3" />}
      {!b.icon && KIND_GLYPH[b.kind] && (
        <span aria-hidden className="grid size-6 flex-none place-items-center rounded-lg bg-muted text-[13px] text-fg-2">
          {KIND_GLYPH[b.kind]}
        </span>
      )}
      <h3 className="min-w-0 flex-1 truncate text-[15.5px] font-medium tracking-[-0.02em]">{b.title}</h3>
      {b.href && <ChevronRight className="size-4 text-fg-4" />}
    </>
  );
  return (
    <section className={`card min-w-0 ${pad} ${span}`}>
      {b.href ? (
        <Link href={b.href} transitionTypes={['nav-forward']} className="-mx-1 -mt-1 mb-3 flex items-center gap-2 rounded-xl px-1 py-1">
          {head}
        </Link>
      ) : (
        <div className="mb-3 flex items-center gap-2">{head}</div>
      )}
      <WidgetBody b={b} />
      <Fresh source={b.source} as_of={b.as_of} stale_after_hours={b.stale_after_hours} />
    </section>
  );
}

/**
 * Bento grid: 2 columns on phones, 4 on wide screens, dense packing. Metric items become
 * tiles of their own (first one is the dark feature tile); charts take big squares,
 * tables run full width, lists and links sit wide.
 */
export function Bento({ blocks, look }: { blocks: Block[]; look?: 'cards' | 'compact' | 'focus' }) {
  return (
    <div className={`grid grid-cols-2 [grid-auto-flow:dense] md:grid-cols-4 ${look === 'compact' ? 'gap-2' : 'gap-3'}`}>
      {blocks.map((b) =>
        b.type === 'section' ? (
          <h2 key={b.key} className="kicker col-span-2 mt-3 md:col-span-4">
            {b.title}
          </h2>
        ) : b.type === 'metric' ? (
          <MetricTile key={b.key} b={b} />
        ) : (
          <WidgetTile key={b.key} b={b} />
        ),
      )}
    </div>
  );
}

/**
 * Turn a metrics data object into tiles. The first tile can be the feature (2 columns).
 * The last tile stretches to finish its row, so groups never leave holes:
 * phones have 2 columns, wide screens 4.
 */
export function metricBlocks(
  prefix: string,
  items: Metric[],
  opts: { group?: string; featureFirst?: boolean } & Freshness = {},
): Block[] {
  const n = items.length;
  const units = (cols: number) => items.reduce((u, _, i) => u + (opts.featureFirst && i === 0 ? Math.min(2, cols) : 1), 0);
  const fill = (cols: number) => {
    const r = units(cols) % cols;
    return r === 0 ? 0 : cols - r; // extra columns the last tile should take
  };
  const extraM = fill(2);
  const extraD = fill(4);
  return items.map((m, i) => {
    const base = opts.featureFirst && i === 0 ? 2 : 1;
    const last = i === n - 1;
    const mobile = Math.min(2, base + (last ? extraM : 0));
    const desktop = Math.min(4, base + (last ? extraD : 0));
    const span = `${mobile === 2 ? 'col-span-2' : 'col-span-1'} ${['', 'md:col-span-1', 'md:col-span-2', 'md:col-span-3', 'md:col-span-4'][desktop]}`;
    return {
      type: 'metric',
      key: `${prefix}-${m.id}`,
      m,
      group: i === 0 ? opts.group : undefined,
      feature: opts.featureFirst && i === 0,
      span,
      ...(i === 0 ? { source: opts.source, as_of: opts.as_of, stale_after_hours: opts.stale_after_hours } : {}),
    };
  });
}
