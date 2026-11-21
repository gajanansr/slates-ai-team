import type { ChartData } from '@/lib/kinds';

/** Compact value with the chart's prefix/suffix: 1,284 · 12.9K · ₹4.2M. */
export function fmt(v: number | null | undefined, d: Pick<ChartData, 'prefix' | 'suffix'>, compact = true) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const abs = Math.abs(v);
  const n =
    compact && abs >= 10_000
      ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
      : new Intl.NumberFormat('en', { maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 }).format(v);
  return `${d.prefix ?? ''}${n}${d.suffix ?? ''}`;
}

/** "Nice" axis ticks covering [min, max], including 0. */
export function niceTicks(min: number, max: number, count = 4, integers = false) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  // Counts never get fractional ticks.
  if (integers) step = Math.max(1, Math.ceil(step));
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}

/** Last non-null value of the first series, for tiles and summaries. */
export function latest(d: ChartData) {
  const s = d.series[0];
  for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return { value: s.values[i] as number, label: d.labels[i], name: s.name };
  return null;
}
