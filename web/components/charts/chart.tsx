'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChartData } from '@/lib/kinds';
import { fmt, niceTicks } from '@/lib/chart-format';

/**
 * Slates chart. Hand-rolled SVG following the dataviz specs:
 * bars <= 24px with 4px rounded data-ends (square at the baseline) and 2px surface
 * gaps; 2px lines; >= 8px end dots with a 2px surface ring; 10% area wash; hairline
 * solid grid; legend for >= 2 series; selective labels; hover/tap tooltip; table view.
 * Colours come from validated CSS tokens (--chart-1..4) so light/dark both pass.
 */
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const SURFACE = 'var(--surface)';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Column path: rounded 4px at the data end, square at the baseline (works for negatives). */
function barPath(x: number, w: number, y0: number, y1: number) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return '';
  if (up) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

export function Chart({ data, mode = 'full' }: { data: ChartData; mode?: 'card' | 'full' }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const gid = useId().replace(/:/g, '');
  const single = data.series.length === 1;
  const height = mode === 'card' ? 150 : 210;

  if (data.type === 'parts') return <Parts data={data} mode={mode} />;

  const values = data.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(...values, 0), Math.max(...values, 0), mode === 'card' ? 3 : 4, values.every((v) => Number.isInteger(v)));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const tickLabels = ticks.map((t) => fmt(t, data));
  const padL = Math.min(56, Math.max(...tickLabels.map((t) => t.length)) * 6.6 + 10);
  const padR = data.type === 'bar' ? 4 : 10;
  const padT = 10;
  const padB = 24;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const n = data.labels.length;
  const band = plotW / n;
  const xCenter = (i: number) => padL + band * i + band / 2;
  const xLine = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const xAt = data.type === 'bar' ? xCenter : xLine;

  // Show at most ~6 x labels so they never collide.
  const labelW = Math.max(...data.labels.map((l) => l.length)) * 6.5 + 12;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / labelW))));
  // Single-series bars emphasise the chosen point, else the latest one (current period in the accent).
  const lastIdx = (() => {
    const vs = data.series[0].values;
    for (let i = vs.length - 1; i >= 0; i--) if (vs[i] !== null) return i;
    return -1;
  })();
  const highlight = data.highlight ?? lastIdx;

  const onMove = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    setActive(best);
  };

  const summary = `${data.type} chart of ${data.series.map((s) => s.name).join(', ')} across ${n} points`;

  return (
    <div className="space-y-3">
      {!single && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {data.series.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
              <span className="size-2.5 rounded-full" style={{ background: SERIES[i] }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <div
        ref={box}
        data-sensitive-chart
        className="relative touch-pan-y select-none"
        style={{ height }}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible">
            {/* grid + axis labels */}
            {ticks.map((t, i) => (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-base)' : 'var(--chart-grid)'} strokeWidth={1} />
                <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px] tabular-nums">
                  {tickLabels[i]}
                </text>
              </g>
            ))}
            {data.labels.map((l, i) =>
              i % every === 0 || i === n - 1 ? (
                <text key={i} x={xAt(i)} y={height - 6} textAnchor={data.type === 'bar' ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-fg-3 text-[11px]">
                  {l}
                </text>
              ) : null,
            )}

            {data.type === 'bar' &&
              data.series.map((s, si) => {
                const groupW = Math.min(band * 0.72, single ? 24 : 24 * data.series.length + 2 * (data.series.length - 1));
                const barW = Math.min(24, (groupW - 2 * (data.series.length - 1)) / data.series.length);
                return s.values.map((v, i) => {
                  if (v === null) return null;
                  const x = xCenter(i) - groupW / 2 + si * (barW + 2);
                  const emphasis = single && (highlight === i || active === i);
                  const fill = single ? (emphasis ? 'var(--chart-hl)' : 'var(--ink)') : SERIES[si];
                  return (
                    <path
                      key={`${s.id}-${i}`}
                      d={barPath(x, barW, y(0), y(v))}
                      fill={fill}
                      opacity={active !== null && active !== i ? 0.45 : 1}
                      className="transition-opacity duration-150"
                    />
                  );
                });
              })}

            {(data.type === 'line' || data.type === 'area') &&
              data.series.map((s, si) => {
                const color = single ? 'var(--ink)' : SERIES[si];
                const pts = s.values.map((v, i) => (v === null ? null : ([xLine(i), y(v)] as const)));
                const segs: string[] = [];
                let cur = '';
                pts.forEach((p) => {
                  if (!p) {
                    if (cur) segs.push(cur);
                    cur = '';
                  } else cur += `${cur ? 'L' : 'M'}${p[0]},${p[1]}`;
                });
                if (cur) segs.push(cur);
                const valid = pts.filter(Boolean) as (readonly [number, number])[];
                const last = valid[valid.length - 1];
                const area =
                  data.type === 'area' && valid.length > 1
                    ? `M${valid[0][0]},${y(0)}L${valid.map((p) => `${p[0]},${p[1]}`).join('L')}L${last[0]},${y(0)}Z`
                    : '';
                return (
                  <g key={s.id}>
                    {area && <path d={area} fill={color} opacity={0.1} />}
                    {segs.map((d, k) => (
                      <path key={k} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {last && <circle cx={last[0]} cy={last[1]} r={4} fill={single ? 'var(--chart-hl)' : color} stroke={SURFACE} strokeWidth={2} />}
                  </g>
                );
              })}

            {/* crosshair + active dots */}
            {active !== null && data.type !== 'bar' && (
              <g>
                <line x1={xLine(active)} x2={xLine(active)} y1={padT} y2={padT + plotH} stroke="var(--chart-base)" strokeWidth={1} />
                {data.series.map((s, si) =>
                  s.values[active] === null ? null : (
                    <circle key={s.id} cx={xLine(active)} cy={y(s.values[active] as number)} r={4.5} fill={single ? 'var(--ink)' : SERIES[si]} stroke={SURFACE} strokeWidth={2} />
                  ),
                )}
              </g>
            )}

            {/* one selective direct label: the end value of a single line */}
            {single && data.type !== 'bar' && active === null && mode === 'full' && (() => {
              const vs = data.series[0].values;
              let i = vs.length - 1;
              while (i >= 0 && vs[i] === null) i--;
              if (i < 0) return null;
              return (
                <text x={xLine(i)} y={y(vs[i] as number) - 10} textAnchor="end" className="fill-fg text-[12px] font-medium tabular-nums">
                  {fmt(vs[i], data)}
                </text>
              );
            })()}
          </svg>
        )}

        {active !== null && width > 0 && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 min-w-[120px] rounded-2xl bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-float)]"
            style={{ left: Math.min(Math.max(xAt(active) - 70, 0), Math.max(0, width - 150)) }}
          >
            <p className="mb-1 font-medium text-fg">{data.labels[active]}</p>
            {data.series.map((s, si) => (
              <p key={s.id} className="flex items-center justify-between gap-3 text-fg-2">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: single ? 'var(--ink)' : SERIES[si] }} aria-hidden />
                  {s.name}
                </span>
                <span className="tabular-nums text-fg">{fmt(s.values[active], data, false)}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {data.caption && <p className="text-[13px] text-fg-3">{data.caption}</p>}

      {mode === 'full' && (
        <div>
          <button type="button" onClick={() => setTable((t) => !t)} className="text-[13px] font-medium text-fg-2 underline decoration-fg-4 underline-offset-4" aria-expanded={table} aria-controls={`t-${gid}`}>
            {table ? 'Hide table' : 'Show as table'}
          </button>
          {table && (
            <div id={`t-${gid}`} className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-fg-3">
                    <th className="py-2 pr-3 font-medium"> </th>
                    {data.series.map((s) => (
                      <th key={s.id} className="py-2 pr-3 text-right font-medium">
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.labels.map((l, i) => (
                    <tr key={i} className="border-b border-line">
                      <td className="py-2 pr-3 text-fg-2">{l}</td>
                      {data.series.map((s) => (
                        <td key={s.id} data-sensitive className="py-2 pr-3 text-right tabular-nums">
                          {fmt(s.values[i], data, false)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Parts of a whole: a tall segmented bar (28px, 4px corners, 2px gaps) + legend. */
function Parts({ data, mode }: { data: ChartData; mode: 'card' | 'full' }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const vals = data.series[0].values.map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const colors = data.labels.map((_, i) => (i < 4 ? SERIES[i] : 'var(--ink-4)'));
  const gaps = 2 * (vals.filter((v) => v > 0).length - 1);
  let x = 0;
  return (
    <div className="space-y-3">
      <div ref={box} data-sensitive-chart className="h-7" role="img" aria-label={data.labels.map((l, i) => `${l} ${Math.round((vals[i] / total) * 100)}%`).join(', ')}>
        {width > 0 && (
          <svg width={width} height={28} className="block">
            {vals.map((v, i) => {
              if (v <= 0) return null;
              const w = ((width - gaps) * v) / total;
              const seg = (
                <g key={i}>
                  <rect x={x} y={0} width={w} height={28} rx={4} fill={colors[i]} />
                  {w > 44 && (
                    <text x={x + 8} y={18.5} className="text-[12px] font-medium tabular-nums" fill="var(--chart-on)">
                      {Math.round((v / total) * 100)}%
                    </text>
                  )}
                </g>
              );
              x += w + 2;
              return seg;
            })}
          </svg>
        )}
      </div>
      <ul className="space-y-1.5" aria-label="Legend">
        {data.labels.map((l, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px]">
            <span className="size-2.5 flex-none rounded-full" style={{ background: colors[i] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-fg-2">{l}</span>
            {mode === 'full' && <span data-sensitive className="tabular-nums text-fg">{fmt(vals[i], data, false)}</span>}
            <span className="w-10 text-right tabular-nums text-fg-3">{Math.round((vals[i] / total) * 100)}%</span>
          </li>
        ))}
      </ul>
      {data.caption && <p className="text-[13px] text-fg-3">{data.caption}</p>}
    </div>
  );
}

/** Tiny trend line for metric tiles (de-emphasis ink, current point in the accent). */
export function Sparkline({ values, className = '' }: { values: number[]; className?: string }) {
  const w = 100;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)] as const);
  const last = pts[pts.length - 1];
  return (
    <div className={`relative h-7 w-full ${className}`} aria-hidden>
      {/* The line stretches to the tile; the dot is HTML so it stays round. */}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--chart-hl)] ring-[1.5px] ring-[var(--surface)]"
        style={{ left: `${(last[0] / w) * 100}%`, top: `${(last[1] / h) * 100}%` }}
      />
    </div>
  );
}
