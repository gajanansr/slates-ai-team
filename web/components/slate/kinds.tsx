import { fitNumber, isNumberish } from '@/lib/fit-number';
import { InlineText } from '@/components/ui/inline-text';
import { plainText } from '@/lib/inline';
import Markdown from 'react-markdown';
import { remarkGfmSafe } from '@/lib/markdown';
import { ArrowUpRight } from 'lucide-react';
import type {
  BriefData,
  ListData,
  LinksData,
  MarkdownData,
  MetricsData,
  Slate,
  TableData,
  TimelineData,
} from '@/lib/kinds';
import { ItemCheck } from '@/components/slate/item-check';
import { Sparkline } from '@/components/charts/chart';
import { ListDetail } from '@/components/slate/list-detail';

type Mode = 'card' | 'full';
type P<T> = { slate: Slate; data: T; mode: Mode; widgetId?: string };

const Tone = ({ tone }: { tone?: string }) => <span className={`tone tone-${tone ?? 'neutral'}`} aria-hidden />;
const more = (n: number) => (n > 0 ? <p className="pt-2 text-xs text-fg-3">+{n} more</p> : null);
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

export function BriefView({ slate, data, widgetId }: P<BriefData>) {
  return (
    <div>
      {data.headline && <p className="mb-3 text-[17px] font-medium leading-snug tracking-tight text-fg">{data.headline}</p>}
      <ul className="space-y-0.5">
        {data.items.map((it) => (
          <li key={it.id} className="flex items-start gap-3.5 py-2 [&>button]:mt-[-6px]">
            <ItemCheck slug={slate.slug} id={it.id} done={Boolean(it.done)} label={plainText(it.text)} tone={it.tone} widgetId={widgetId} />
            <span
              className={`text-[15px] leading-snug ${it.done ? 'text-fg-4 line-through decoration-fg-4' : it.tone === 'bad' ? 'font-medium text-fg' : 'text-fg-2'}`}
            >
              <InlineText text={it.text} />
            </span>
          </li>
        ))}
      </ul>
      {data.items.length === 0 && <p className="text-sm text-fg-3">Nothing on the brief yet.</p>}
    </div>
  );
}

export function ListView({ slate, data, mode, widgetId }: P<ListData>) {
  const items = mode === 'card' ? data.items.slice(0, 5) : data.items;
  if (data.items.length === 0) return <p className="text-sm text-fg-3">Empty list.</p>;
  return (
    <div>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-3 py-2.5 [&>button:first-child]:mt-[-7px]">
            <ItemCheck slug={slate.slug} id={it.id} done={Boolean(it.done)} label={plainText(it.text)} tone={it.tone} widgetId={widgetId} />
            {/* Text first and flexible; metadata wraps under it instead of squeezing it (BUG-01). */}
            <div className="min-w-0 flex-1">
              <p className={`text-[15px] leading-snug [overflow-wrap:anywhere] ${it.done ? 'text-fg-4 line-through decoration-fg-4' : 'text-fg'}`}><InlineText text={it.text} /></p>
              {it.meta && (
                <p data-sensitive className="tabular mt-0.5 font-mono text-[12px] leading-snug text-fg-3 [overflow-wrap:anywhere]">
                  {it.meta}
                </p>
              )}
              {it.detail && mode === 'full' && <ListDetail text={it.detail} />}
            </div>
            {it.href && (
              <a
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                className="-mr-1 grid size-8 flex-none place-items-center rounded-full text-fg-3 active:bg-muted"
                aria-label={`Open source for ${it.text}`}
              >
                <ArrowUpRight className="size-4" strokeWidth={1.75} />
              </a>
            )}
          </li>
        ))}
      </ul>
      {mode === 'card' && more(data.items.length - items.length)}
    </div>
  );
}

export function LinksView({ data, mode }: P<LinksData>) {
  const items = mode === 'card' ? data.items.slice(0, 4) : data.items;
  if (data.items.length === 0) return <p className="text-sm text-fg-3">No links yet.</p>;
  return (
    <div>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="row-hover -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-fg">{it.title}</span>
                <span className="block truncate text-[12.5px] text-fg-3">{it.detail || host(it.url)}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
            </a>
          </li>
        ))}
      </ul>
      {mode === 'card' && more(data.items.length - items.length)}
    </div>
  );
}

export function MetricsView({ data, mode }: P<MetricsData>) {
  const items = mode === 'card' ? data.items.slice(0, 4) : data.items;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 [&>*]:min-w-0">
        {items.map((m) => (
          <div
            key={m.id}
            className={`relative rounded-2xl p-3.5 ${m.tone === 'bad' ? 'bg-accent text-on-accent' : m.tone === 'good' ? 'bg-sage' : 'bg-muted'}`}
          >
            <p className="flex items-start gap-2 text-[12px] leading-snug text-fg-3 [&>span:last-child]:line-clamp-2">
              {m.tone && m.tone !== 'neutral' && (
                <span className="mt-[5px]">
                  <Tone tone={m.tone} />
                </span>
              )}
              <span>{m.label}</span>
            </p>
            <p
              data-sensitive
              title={m.value}
              style={isNumberish(m.value) ? { fontSize: fitNumber(m.value, 22) } : undefined}
              className={`tabular mt-1 font-semibold leading-tight tracking-[-0.03em] ${isNumberish(m.value) ? 'whitespace-nowrap' : 'line-clamp-2 break-words text-[clamp(17px,5vw,20px)]'}`}
            >
              {m.href ? (
                <a href={m.href} target="_blank" rel="noopener noreferrer" className="underline decoration-fg-4 underline-offset-4">
                  {m.value}
                </a>
              ) : (
                m.value
              )}
            </p>
            {m.sub && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-fg-3">{m.sub}</p>}
            {m.trend && m.trend.length > 1 && <Sparkline values={m.trend} className="mt-2" />}
            {typeof m.progress === 'number' && (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-fg" style={{ width: `${m.progress}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
      {data.asOf && <p className="mt-3 text-xs text-fg-4">As of {data.asOf}</p>}
      {mode === 'card' && more(data.items.length - items.length)}
    </div>
  );
}

export function TimelineView({ data, mode }: P<TimelineData>) {
  const entries = mode === 'card' ? data.entries.slice(0, 2) : data.entries;
  if (data.entries.length === 0) return <p className="text-sm text-fg-3">Nothing logged yet.</p>;
  return (
    <div>
      <ol className="relative space-y-5 border-l border-line pl-5">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[24.5px] top-[5px] size-2 rounded-full border border-fg-3 bg-page" />
            <p className="kicker !normal-case !tracking-wide">{e.date}</p>
            {e.title && <p className="mt-1 text-[15px] font-medium text-fg">{e.title}</p>}
            <ul className="mt-1.5 space-y-1">
              {(mode === 'card' ? e.items.slice(0, 3) : e.items).map((t, i) => (
                <li key={i} className="text-[14px] leading-snug text-fg-2">
                  {t}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {mode === 'card' && more(data.entries.length - entries.length)}
    </div>
  );
}

export function TableView({ data, mode }: P<TableData>) {
  const rows = mode === 'card' ? data.rows.slice(0, 4) : data.rows;
  const [first, ...rest] = data.columns;
  if (data.rows.length === 0) return <p className="text-sm text-fg-3">No rows yet.</p>;
  const endCol = [...data.columns].reverse().find((c) => c.align === 'end');

  return (
    <div>
      {/* Phone: each row is a compact block */}
      <ul className={`divide-y divide-line ${mode === 'full' ? 'md:hidden' : ''}`}>
        {rows.map((r) => (
          <li key={r.id} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] text-fg">{r.cells[first.key]}</span>
              {endCol && endCol !== first && (
                <span data-sensitive className="tabular shrink-0 font-mono text-[13px] text-fg">{r.cells[endCol.key]}</span>
              )}
            </div>
            {mode === 'full' ? (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                {rest
                  .filter((c) => c !== endCol && r.cells[c.key])
                  .map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-fg-4">{c.label}</dt>
                      <dd className="text-fg-2">{r.cells[c.key]}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="mt-0.5 truncate text-[12.5px] text-fg-3">
                {rest
                  .filter((c) => c !== endCol && r.cells[c.key])
                  .slice(0, 2)
                  .map((c) => r.cells[c.key])
                  .join(' · ')}
              </p>
            )}
          </li>
        ))}
      </ul>
      {/* Desktop: a real table */}
      {mode === 'full' && (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                {data.columns.map((c) => (
                  <th key={c.key} className={`kicker px-3 py-2.5 font-normal ${c.align === 'end' ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-hover border-b border-line transition-colors">
                  {data.columns.map((c, i) => (
                    <td
                      key={c.key}
                      data-sensitive={c.align === 'end' ? '' : undefined}
                      className={`px-3 py-3 align-top ${i === 0 ? 'text-fg' : 'text-fg-2'} ${c.align === 'end' ? 'tabular text-right font-mono text-[13px]' : ''}`}
                    >
                      {r.cells[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === 'card' && more(data.rows.length - rows.length)}
    </div>
  );
}

export function MarkdownView({ data, mode }: P<MarkdownData>) {
  if (!data.body.trim()) return <p className="text-sm text-fg-3">Empty note.</p>;
  return (
    <div className={`prose-slate ${mode === 'card' ? 'line-clamp-6' : ''}`}>
      <Markdown
        remarkPlugins={[remarkGfmSafe]}
        components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}
      >
        {data.body}
      </Markdown>
    </div>
  );
}
