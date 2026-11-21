'use client';
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import type { CountdownData, GoalsData, HabitsData, Slate, TrackerDataT } from '@/lib/kinds';
import { addDays, daysLabel, daysUntil, pct, streak, today } from '@/lib/summary';
import { moveTrackerItem, toggleHabitDay } from '@/app/(app)/actions';
import { useReadOnly } from '@/components/readonly';

type Mode = 'card' | 'full';
type P<T> = { slate: Slate; data: T; mode: Mode };

const shortDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ------------------------------------------------------------------ Tracker (kanban)

export function TrackerView(props: P<TrackerDataT>) {
  return props.mode === 'card' ? <TrackerCards {...props} /> : <TrackerBoard {...props} />;
}

function TrackerCards({ data }: P<TrackerDataT>) {
  const stages = data.stages;
  return (
    <div className="flex gap-1.5">
      {stages.map((s) => {
        const n = data.items.filter((i) => i.stage === s.id).length;
        return (
          <div key={s.id} className="min-w-0 flex-1 rounded-2xl bg-muted px-3 py-2.5">
            <p className="tabular text-[20px] font-semibold tracking-[-0.03em]">{n}</p>
            <p className="truncate text-[12px] text-fg-3">{s.name}</p>
          </div>
        );
      })}
    </div>
  );
}

function TrackerBoard({ slate, data }: P<TrackerDataT>) {
  const ro = useReadOnly();
  const [items, setItems] = useOptimistic(data.items);
  const [, start] = useTransition();
  const stages = data.stages;

  const move = (id: string, stage: string) =>
    start(async () => {
      setItems(items.map((i) => (i.id === id ? { ...i, stage } : i)));
      await moveTrackerItem(slate.slug, id, stage);
    });

  // ---- Drag and drop: hold a card (touch) or drag it (mouse), carry it over a column, let go.
  type Drag = { id: string; title: string; x: number; y: number; dx: number; dy: number; w: number; over: string | null };
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef({ items, move });
  latest.current = { items, move };

  const stageAt = useCallback((x: number, y: number) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const col = (el as HTMLElement).closest?.('[data-stage]') as HTMLElement | null;
      if (col && scroller.current?.contains(col)) return col.dataset.stage ?? null;
    }
    return null;
  }, []);

  // While a card is carried the page must not scroll under the finger.
  useEffect(() => {
    const stop = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  const press = (e: React.PointerEvent<HTMLLIElement>, id: string, title: string) => {
    if (ro || dragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('a,button')) return;
    const el = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    const touch = e.pointerType !== 'mouse';
    let timer = 0;
    let raf = 0;
    const off = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const finish = (drop: boolean) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onCarry);
      window.removeEventListener('pointerup', onDrop);
      window.removeEventListener('pointercancel', onAbort);
      window.removeEventListener('keydown', onKey);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      const item = latest.current.items.find((i) => i.id === id);
      if (drop && d?.over && item && item.stage !== d.over) latest.current.move(id, d.over);
    };
    const onCarry = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: ev.clientX, y: ev.clientY, over: stageAt(ev.clientX, ev.clientY) };
      dragRef.current = next;
      setDrag(next);
    };
    const onDrop = () => finish(true);
    const onAbort = () => finish(false);
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false);
    const tick = () => {
      const d = dragRef.current;
      if (!d) return;
      const sc = scroller.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (d.x < r.left + 56) sc.scrollLeft -= 14;
        else if (d.x > r.right - 56) sc.scrollLeft += 14;
      }
      if (d.y < 96) window.scrollBy(0, -12);
      else if (d.y > window.innerHeight - 120) window.scrollBy(0, 12);
      const over = stageAt(d.x, d.y);
      if (over !== d.over) {
        const next = { ...d, over };
        dragRef.current = next;
        setDrag(next);
      }
      raf = requestAnimationFrame(tick);
    };
    const lift = () => {
      off();
      const r = el.getBoundingClientRect();
      const d: Drag = { id, title, x: sx, y: sy, dx: sx - r.left, dy: sy - r.top, w: r.width, over: stageAt(sx, sy) };
      dragRef.current = d;
      setDrag(d);
      try {
        navigator.vibrate?.(12);
      } catch {}
      window.addEventListener('pointermove', onCarry);
      window.addEventListener('pointerup', onDrop);
      window.addEventListener('pointercancel', onAbort);
      window.addEventListener('keydown', onKey);
      raf = requestAnimationFrame(tick);
    };
    const onMove = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      // Touch: moving before the hold is up means the finger is scrolling. Mouse: a short drag lifts it.
      if (touch && moved > 8) off();
      else if (!touch && moved > 5) lift();
    };
    const onUp = () => off();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    if (touch) timer = window.setTimeout(lift, 260);
  };

  const dragged = drag ? items.find((i) => i.id === drag.id) : undefined;

  return (
    <>
    <div ref={scroller} className={`no-scrollbar -mx-4 flex scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:scroll-px-0 md:px-0 ${drag ? 'snap-none' : 'snap-x snap-mandatory'}`}>
      {stages.map((s, si) => {
        const col = items.filter((i) => i.stage === s.id);
        const next = stages[si + 1];
        const target = !!drag && drag.over === s.id && dragged?.stage !== s.id;
        return (
          <section key={s.id} data-stage={s.id} className={`w-[78%] flex-none snap-start rounded-[20px] p-2.5 transition-colors sm:w-64 ${target ? 'bg-[color-mix(in_srgb,var(--accent)_38%,var(--muted))] ring-2 ring-[var(--olive)]' : 'bg-muted'}`} aria-label={s.name}>
            <h3 className="mb-2 flex items-center justify-between px-1.5 pt-0.5 text-[13px] font-medium text-fg-2">
              {s.name}
              <span className="tabular text-fg-4">{col.length}</span>
            </h3>
            <ul className="space-y-2">
              {col.map((it) => (
                <li
                  key={it.id}
                  onPointerDown={(e) => press(e, it.id, it.title)}
                  onContextMenu={(e) => !ro && e.preventDefault()}
                  className={`select-none rounded-2xl bg-surface p-3 shadow-[0_1px_0_var(--line)] [-webkit-touch-callout:none] ${drag?.id === it.id ? 'opacity-40' : ''}`}
                >
                  <p className="text-[14.5px] leading-snug [overflow-wrap:anywhere]">{it.title}</p>
                  {(it.meta || it.due) && (
                    <p className="mt-1 text-[12px] text-fg-3">
                      {it.due && <span className={daysUntil(it.due) < 0 ? 'font-medium text-fg' : ''}>Due {shortDate(it.due)}</span>}
                      {it.due && it.meta ? ' · ' : ''}
                      {it.meta}
                    </p>
                  )}
                  {it.detail && <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-fg-3">{it.detail}</p>}
                  <div className="mt-2 flex items-center justify-end gap-1">
                    {it.href && (
                      <a href={it.href} target="_blank" rel="noopener noreferrer" aria-label={`Open link for ${it.title}`} className="grid size-8 place-items-center rounded-full text-fg-3 active:bg-muted">
                        <ArrowUpRight className="size-4" strokeWidth={1.75} />
                      </a>
                    )}
                    {next && !ro && (
                      <button type="button" onClick={() => move(it.id, next.id)} className="flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[12.5px] font-medium active:scale-95">
                        {next.name} <ArrowRight className="size-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {col.length === 0 && <li className="px-1.5 py-3 text-[13px] text-fg-4">{target ? 'Drop here' : 'Nothing here'}</li>}
            </ul>
          </section>
        );
      })}
    </div>
    {drag &&
      createPortal(
        <div aria-hidden className="pointer-events-none fixed z-[90] rounded-2xl bg-surface p-3 shadow-[var(--shadow-float)] ring-1 ring-[var(--line)]" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w, transform: 'rotate(2.5deg) scale(1.03)' }}>
          <p className="text-[14.5px] leading-snug [overflow-wrap:anywhere]">{drag.title}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

// ------------------------------------------------------------------ Habits

export function HabitsView({ slate, data, mode }: P<HabitsData>) {
  const ro = useReadOnly();
  const [habits, setHabits] = useOptimistic(data.items);
  const [, start] = useTransition();
  const [day] = useState(() => today());
  const week = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));

  const toggle = (id: string, d: string) =>
    start(async () => {
      setHabits(habits.map((h) => (h.id !== id ? h : { ...h, days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d] })));
      await toggleHabitDay(slate.slug, id, d);
    });

  if (habits.length === 0) return <p className="text-sm text-fg-3">No habits yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {habits.map((h) => {
        const set = new Set(h.days);
        const s = streak(h.days, h.goal);
        return (
          <li key={h.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[15px] font-medium">{h.name}</p>
              <p className="tabular flex-none text-[13px] text-fg-3">{s > 0 ? `${s} day streak` : 'No streak yet'}</p>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {week.map((d) => {
                const on = set.has(d);
                const isToday = d === day;
                const label = new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { weekday: 'narrow', timeZone: 'UTC' });
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={ro}
                    aria-pressed={on}
                    aria-label={`${h.name} on ${shortDate(d)}${on ? ', done' : ''}`}
                    onClick={() => toggle(h.id, d)}
                    className={`flex h-11 flex-col items-center justify-center rounded-xl text-[11px] transition-colors active:scale-95 ${
                      on ? 'bg-btn text-on-btn' : 'bg-muted text-fg-3'
                    } ${isToday ? 'ring-[1.5px] ring-fg' : ''}`}
                  >
                    <span>{label}</span>
                    {on ? <Check className="size-3.5" strokeWidth={2.5} /> : <span className="tabular text-[12px]">{d.slice(8)}</span>}
                  </button>
                );
              })}
            </div>
            {mode === 'full' && <HabitGrid days={set} end={day} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Habits inside a dashboard: name, streak and the last 7 days, read-only. Ticking happens on the
 * habits board itself (a dashboard widget holds a copy, not the board).
 */
export function HabitsSummary({ data }: { data: HabitsData }) {
  const [day] = useState(() => today());
  const week = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));
  if (!data.items.length) return <p className="text-sm text-fg-3">No habits yet.</p>;
  return (
    <ul className="space-y-2.5">
      {data.items.map((h) => {
        const set = new Set(h.days);
        const s = streak(h.days, h.goal);
        return (
          <li key={h.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{h.name}</span>
              <span className="block text-[12px] text-fg-3">{s > 0 ? `${s} day streak` : 'No streak yet'}</span>
            </span>
            <span className="flex flex-none gap-1" aria-label={`Last 7 days: ${week.filter((d) => set.has(d)).length} done`}>
              {week.map((d) => (
                <span key={d} className={`size-2.5 rounded-full ${set.has(d) ? 'bg-fg' : 'bg-muted'} ${d === day ? 'ring-1 ring-fg ring-offset-1 ring-offset-[var(--surface)]' : ''}`} />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Last 12 weeks, GitHub-style: columns are weeks, rows Monday..Sunday. */
function HabitGrid({ days, end }: { days: Set<string>; end: string }) {
  const endDow = (new Date(`${end}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(end, -(11 * 7 + endDow));
  const cells = Array.from({ length: 12 * 7 }, (_, i) => addDays(start, Math.floor(i / 7) * 7 + (i % 7)));
  const done = cells.filter((c) => c <= end && days.has(c)).length;
  return (
    <div className="mt-3 max-w-[260px]">
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))' }} aria-hidden>
        {cells.map((c) => (
          <span key={c} className={`aspect-square rounded-[3px] ${c > end ? 'opacity-0' : days.has(c) ? 'bg-fg' : 'bg-muted'}`} />
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-fg-4">{done} of the last 12 weeks&apos; days</p>
    </div>
  );
}

// ------------------------------------------------------------------ Goals

export function GoalsView({ data, mode }: P<GoalsData>) {
  const items = mode === 'card' ? data.items.slice(0, 3) : data.items;
  if (items.length === 0) return <p className="text-sm text-fg-3">No goals yet.</p>;
  const num = (n: number, prefix = '', unit = '') => `${prefix}${n.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
  return (
    <ul className="space-y-4">
      {items.map((g) => {
        const p = pct(g.current, g.target);
        const left = g.deadline ? daysUntil(g.deadline) : null;
        return (
          <li key={g.id}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-[15px] font-medium leading-snug">{g.title}</p>
              <p className="tabular flex-none text-[20px] font-semibold tracking-[-0.03em]">{p}%</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={g.title}>
              <div className="h-full rounded-full bg-fg transition-[width] duration-500" style={{ width: `${p}%` }} />
            </div>
            <p data-sensitive className="tabular mt-1.5 text-[12.5px] text-fg-3">
              {num(g.current, g.prefix, g.unit)} of {num(g.target, g.prefix, g.unit)}
              {left !== null && <> · {left >= 0 ? `${daysLabel(left).toLowerCase()} left` : `deadline passed ${-left}d ago`}</>}
            </p>
            {g.detail && mode === 'full' && <p className="mt-1 text-[13px] text-fg-3">{g.detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ Countdown

export function CountdownView({ data, mode }: P<CountdownData>) {
  const sorted = [...data.items].sort((a, b) => a.date.localeCompare(b.date));
  const ahead = sorted.filter((i) => daysUntil(i.date) >= 0);
  const past = sorted.filter((i) => daysUntil(i.date) < 0).reverse();
  const items = mode === 'card' ? ahead.slice(0, 3) : [...ahead, ...past];
  if (items.length === 0) return <p className="text-sm text-fg-3">Nothing ahead.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => {
        const d = daysUntil(it.date);
        const body = (
          <>
            <span className={`grid size-14 flex-none place-items-center rounded-2xl ${d < 0 ? 'bg-muted text-fg-4' : d <= 7 ? 'bg-accent text-on-accent' : 'bg-muted'}`}>
              <span className="text-center leading-none">
                <span className="tabular block text-[19px] font-semibold tracking-[-0.03em]">{d === 0 ? '0' : Math.abs(d)}</span>
                <span className="block text-[10px]">{d === 0 ? 'today' : d < 0 ? 'ago' : Math.abs(d) === 1 ? 'day' : 'days'}</span>
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[15px] ${d < 0 ? 'text-fg-3' : 'font-medium'}`}>{it.title}</span>
              <span className="block truncate text-[12.5px] text-fg-3">
                {shortDate(it.date)}
                {it.detail ? ` · ${it.detail}` : ''}
              </span>
            </span>
          </>
        );
        return (
          <li key={it.id}>
            {it.href ? (
              <a href={it.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3.5 py-2.5">
                {body}
                <ArrowUpRight className="size-4 flex-none text-fg-3" strokeWidth={1.75} />
              </a>
            ) : (
              <div className="flex items-center gap-3.5 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
