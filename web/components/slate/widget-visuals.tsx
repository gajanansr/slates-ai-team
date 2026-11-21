'use client';
import { useState } from 'react';
import { Flame } from 'lucide-react';
import type { CountdownData, GoalsData, HabitsData, TrackerDataT } from '@/lib/kinds';
import { addDays, daysLabel, daysUntil, pct, streak, today } from '@/lib/summary';
import { GoalsView, HabitsSummary, TrackerView, CountdownView } from '@/components/slate/kinds-more';

type View = 'auto' | 'ring' | 'bars' | 'heatmap' | 'dots' | 'compact' | undefined;
const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A progress ring. `value` is 0-100; children sit in the middle. */
export function Ring({ value, size = 64, stroke = 7, children, label }: { value: number; size?: number; stroke?: number; children?: React.ReactNode; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="relative inline-grid flex-none place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(v)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--chart-hl, var(--ink))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <span className="absolute text-center leading-none">{children}</span>
    </span>
  );
}

// ------------------------------------------------------------------ Goals

export function GoalsWidget({ data, view, mode, slate }: { data: GoalsData; view: View; mode: 'card' | 'full'; slate: any }) {
  if (view === 'bars' || view === 'compact' || data.items.length === 0) return <GoalsView slate={slate} data={data} mode={mode} />;
  const items = mode === 'card' ? data.items.slice(0, 4) : data.items;
  const num = (n: number, prefix = '', unit = '') => `${prefix}${n.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((g) => {
        const p = pct(g.current, g.target);
        const left = g.deadline ? daysUntil(g.deadline) : null;
        return (
          <li key={g.id} className="flex items-center gap-3.5 rounded-2xl bg-muted/70 p-3">
            <Ring value={p} size={64} label={g.title}>
              <span className="tabular text-[15px] font-semibold tracking-[-0.03em]">{p}%</span>
            </Ring>
            <span className="min-w-0">
              <span className="block truncate text-[14.5px] font-medium">{g.title}</span>
              <span data-sensitive className="tabular block truncate text-[12.5px] text-fg-3">
                {num(g.current, g.prefix, g.unit)} of {num(g.target, g.prefix, g.unit)}
              </span>
              {left !== null && <span className="block text-[12px] text-fg-4">{left >= 0 ? `${daysLabel(left).toLowerCase()} left` : `${-left}d overdue`}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ Habits

function MiniHeat({ days, end, weeks }: { days: Set<string>; end: string; weeks: number }) {
  const endDow = (new Date(`${end}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(end, -((weeks - 1) * 7 + endDow));
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, Math.floor(i / 7) * 7 + (i % 7)));
  return (
    <span className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} aria-hidden>
      {cells.map((c) => (
        <span key={c} className={`aspect-square rounded-[3px] ${c > end ? 'opacity-0' : days.has(c) ? 'bg-[var(--chart-hl,var(--ink))]' : 'bg-muted'}`} />
      ))}
    </span>
  );
}

export function HabitsWidget({ data, view }: { data: HabitsData; view: View }) {
  const [day] = useState(() => today());
  if (view === 'dots' || view === 'compact') return <HabitsSummary data={data} />;
  if (!data.items.length) return <p className="text-sm text-fg-3">No habits yet.</p>;
  const week = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));
  return (
    <ul className="space-y-3">
      {data.items.map((h) => {
        const set = new Set(h.days);
        const s = streak(h.days, h.goal);
        const done7 = week.filter((d) => set.has(d)).length;
        return (
          <li key={h.id} className="rounded-2xl bg-muted/70 p-3">
            <div className="flex items-center gap-3">
              {view === 'ring' || view === 'auto' || !view ? (
                <Ring value={(done7 / 7) * 100} size={52} stroke={6} label={`${h.name}, last 7 days`}>
                  <span className="tabular text-[13px] font-semibold">{done7}/7</span>
                </Ring>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{h.name}</span>
                <span className={`mt-0.5 inline-flex items-center gap-1 text-[12.5px] ${s > 0 ? 'text-fg' : 'text-fg-4'}`}>
                  <Flame className={`size-3.5 ${s > 0 ? 'text-[var(--chart-hl,var(--ink))]' : ''}`} strokeWidth={2} />
                  {s > 0 ? `${s} day streak` : 'No streak yet'}
                </span>
              </span>
              <span className="flex flex-none gap-1" aria-hidden>
                {week.map((d) => (
                  <span key={d} className={`size-2.5 rounded-full ${set.has(d) ? 'bg-fg' : 'bg-line'} ${d === day ? 'ring-1 ring-fg ring-offset-1 ring-offset-[var(--surface)]' : ''}`} />
                ))}
              </span>
            </div>
            {view === 'heatmap' && (
              <div className="mt-3">
                <MiniHeat days={set} end={day} weeks={16} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ Countdown

export function CountdownWidget({ data, view, mode, slate }: { data: CountdownData; view: View; mode: 'card' | 'full'; slate: any }) {
  const ahead = [...data.items].filter((i) => daysUntil(i.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  if (view === 'compact' || ahead.length === 0) return <CountdownView slate={slate} data={data} mode={mode} />;
  const [next, ...rest] = ahead;
  const d = daysUntil(next.date);
  // The ring empties as the date nears: 60 days out is full.
  const frac = Math.max(0, Math.min(100, (d / 60) * 100));
  return (
    <div>
      <div className="flex items-center gap-4 rounded-2xl bg-muted/70 p-3.5">
        <Ring value={frac} size={84} stroke={8} label={`${next.title}, ${d} days left`}>
          <span className="block tabular text-[26px] font-semibold tracking-[-0.04em]">{d}</span>
          <span className="block text-[10.5px] text-fg-3">{d === 1 ? 'day' : d === 0 ? 'today' : 'days'}</span>
        </Ring>
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-medium tracking-[-0.02em]">{next.title}</span>
          <span className="block text-[13px] text-fg-3">{shortDate(next.date)}</span>
        </span>
      </div>
      {rest.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {rest.slice(0, mode === 'card' ? 3 : 8).map((i) => (
            <li key={i.id} className="rounded-full bg-muted px-3 py-1.5 text-[12.5px]">
              <span className="font-medium">{i.title}</span> <span className="text-fg-3">· {daysLabel(daysUntil(i.date)).toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Tracker

export function TrackerWidget({ data, view, slate }: { data: TrackerDataT; view: View; slate: any }) {
  if (view === 'compact') return <TrackerView slate={slate} data={data} mode="card" />;
  const total = data.items.length;
  const counts = data.stages.map((s) => ({ s, n: data.items.filter((i) => i.stage === s.id).length }));
  const shades = ['bg-fg', 'bg-fg/70', 'bg-fg/45', 'bg-fg/25', 'bg-fg/12', 'bg-fg/8'];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={counts.map((c) => `${c.s.name}: ${c.n}`).join(', ')}>
        {counts.map(({ s, n }, i) => (n > 0 ? <span key={s.id} className={shades[i % shades.length]} style={{ width: `${(n / (total || 1)) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map(({ s, n }, i) => (
          <li key={s.id} className="rounded-2xl bg-muted/70 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[12px] text-fg-3">
              <span className={`size-2 rounded-full ${shades[i % shades.length]}`} />
              <span className="truncate">{s.name}</span>
            </p>
            <p className="tabular mt-0.5 text-[22px] font-semibold tracking-[-0.03em]">{n}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ List progress

export function ListProgress({ items }: { items: { done?: boolean }[] }) {
  if (!items?.length) return null;
  const done = items.filter((i) => i.done).length;
  const p = Math.round((done / items.length) * 100);
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-baseline justify-between text-[12.5px] text-fg-3">
        <span className="tabular">{done} of {items.length} done</span>
        <span className="tabular">{p}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[var(--chart-hl,var(--ink))] transition-[width] duration-500" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
