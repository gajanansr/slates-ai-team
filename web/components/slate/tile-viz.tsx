import type { Slate } from '@/lib/kinds';
import { addDays, daysUntil, pct, streak, today, upcoming } from '@/lib/summary';

const HL = 'var(--chart-hl, var(--ink))';

function MiniRing({ value, size = 40 }: { value: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={HL} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} />
    </svg>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const v = values.slice(-12);
  const max = Math.max(...v, 1);
  return (
    <span className="flex h-8 items-end gap-[3px]" aria-hidden>
      {v.map((n, i) => (
        <span key={i} className="w-full min-w-[3px] max-w-[9px] rounded-[3px]" style={{ height: `${Math.max(12, (n / max) * 100)}%`, background: i === v.length - 1 ? HL : 'var(--muted)' }} />
      ))}
    </span>
  );
}

function MiniLine({ values }: { values: number[] }) {
  const v = values.slice(-24);
  if (v.length < 2) return null;
  const w = 100, h = 28;
  const min = Math.min(...v), max = Math.max(...v);
  const pts = v.map((n, i) => `${(i / (v.length - 1)) * w},${h - 3 - ((n - min) / (max - min || 1)) * (h - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={HL} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A tiny picture of what's inside a board, so tiles are glanceable and alive. Null when there's nothing to show. */
export function TileViz({ slate }: { slate: Slate }) {
  const d = slate.data as Record<string, any>;
  const arr = (k: string): any[] => (Array.isArray(d?.[k]) ? d[k] : []);
  switch (slate.kind) {
    case 'dashboard': {
      const ws = arr('widgets').filter((w) => !w.hidden).slice(0, 6);
      if (!ws.length) return null;
      const trend = ws.find((w) => w.kind === 'metrics')?.data?.items?.find((m: any) => Array.isArray(m.trend) && m.trend.length > 1)?.trend;
      if (trend) return <MiniLine values={trend} />;
      return (
        <span className="grid h-8 grid-cols-3 grid-rows-2 gap-[3px]" aria-hidden>
          {ws.map((w, i) => (
            <span key={w.id ?? i} className="rounded-[5px]" style={{ background: i === 0 ? HL : 'var(--muted)', opacity: i === 0 ? 0.85 : 1, gridColumn: i === 0 ? 'span 2' : undefined }} />
          ))}
        </span>
      );
    }
    case 'chart': {
      const s0 = (d?.series?.[0]?.values ?? []).filter((n: any) => typeof n === 'number') as number[];
      if (s0.length < 2) return null;
      return d?.type === 'line' || d?.type === 'area' ? <MiniLine values={s0} /> : <MiniBars values={s0} />;
    }
    case 'metrics': {
      const t = arr('items').find((m) => Array.isArray(m.trend) && m.trend.length > 1)?.trend;
      return t ? <MiniLine values={t} /> : null;
    }
    case 'goals': {
      const g = arr('items')[0];
      if (!g) return null;
      return <MiniRing value={pct(g.current, g.target)} />;
    }
    case 'countdown': {
      const n = upcoming(arr('items'))[0];
      if (!n) return null;
      return <MiniRing value={(Math.max(0, daysUntil(n.date)) / 60) * 100} />;
    }
    case 'habits': {
      const h = arr('items').map((x) => ({ x, s: streak(x.days ?? [], x.goal) })).sort((a, b) => b.s - a.s)[0]?.x;
      if (!h) return null;
      const day = today();
      const set = new Set<string>(h.days ?? []);
      return (
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => addDays(day, i - 6)).map((x) => (
            <span key={x} className="size-3 rounded-full" style={{ background: set.has(x) ? HL : 'var(--muted)' }} />
          ))}
        </span>
      );
    }
    case 'tracker': {
      const stages = arr('stages');
      const items = arr('items');
      if (!stages.length || !items.length) return null;
      const op = [1, 0.7, 0.45, 0.28, 0.16, 0.1];
      return (
        <span className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {stages.map((s, i) => {
            const n = items.filter((x) => x.stage === s.id).length;
            return n ? <span key={s.id} style={{ width: `${(n / items.length) * 100}%`, background: HL, opacity: op[i % op.length] }} /> : null;
          })}
        </span>
      );
    }
    default:
      return null;
  }
}
