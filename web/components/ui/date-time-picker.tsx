'use client';
import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const at = (d: Date, h: number, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** "Today, 6:00 pm" / "Tomorrow, 9:00 am" / "Fri 14 Nov, 9:00 am". */
export function whenLabel(d: Date, now = new Date()) {
  const time = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = sameDay(d, now) ? 'Today' : sameDay(d, addDays(now, 1)) ? 'Tomorrow' : d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}

function quickPicks(now: Date) {
  const inHour = new Date(now.getTime() + 60 * 60_000);
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 5) * 5, 0, 0);
  const evening = now.getHours() < 17 ? at(now, 18) : at(addDays(now, 1), 18);
  const monday = addDays(now, ((8 - now.getDay()) % 7) || 7);
  return [
    { label: 'In 1 hour', d: inHour },
    { label: now.getHours() < 17 ? 'This evening' : 'Tomorrow evening', d: evening },
    { label: 'Tomorrow morning', d: at(addDays(now, 1), 9) },
    { label: 'Next Monday', d: at(monday, 9) },
  ];
}

/**
 * The app's date + time picker (instead of the browser's): quick picks, a month calendar and a
 * time row, in a bottom sheet on phones.
 */
export function DateTimePicker({ value, onChange, label = 'Date and time' }: { value: Date; onChange: (d: Date) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const now = new Date();

  const days = useMemo(() => {
    const first = new Date(month);
    const start = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  const h24 = draft.getHours();
  const h12 = h24 % 12 || 12;
  const pm = h24 >= 12;
  const setTime = (h: number, m: number, isPm: boolean) => setDraft(at(draft, (h % 12) + (isPm ? 12 : 0), m));
  const past = draft.getTime() <= Date.now();

  const show = () => {
    setDraft(value);
    setMonth(new Date(value.getFullYear(), value.getMonth(), 1));
    setOpen(true);
  };

  return (
    <>
      <button type="button" onClick={show} aria-label={`${label}: ${whenLabel(value)}`} className="flex h-[50px] w-full min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 text-left text-[16px]">
        <CalendarDays className="size-[18px] flex-none text-fg-3" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">{whenLabel(value)}</span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="When">
        <div className="no-scrollbar -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1">
          {quickPicks(now).map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => {
                onChange(q.d);
                setOpen(false);
              }}
              className="flex h-14 shrink-0 flex-col items-start justify-center rounded-2xl bg-muted px-3.5 text-left active:scale-95"
            >
              <span className="text-[13.5px] font-medium">{q.label}</span>
              <span className="text-[11.5px] text-fg-3">{whenLabel(q.d, now)}</span>
            </button>
          ))}
        </div>

        <div className="mb-2 flex items-center justify-between">
          <p className="text-[15px] font-medium">{month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</p>
          <div className="flex gap-1">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-9 place-items-center rounded-full bg-muted active:scale-95">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-9 place-items-center rounded-full bg-muted active:scale-95">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[11.5px] text-fg-4">
          {WEEK.map((w, i) => (
            <span key={i} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div role="grid" aria-label="Day" className="grid grid-cols-7 gap-y-1">
          {days.map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const gone = d < at(now, 0) ;
            const sel = sameDay(d, draft);
            const today = sameDay(d, now);
            return (
              <button
                key={d.toISOString()}
                type="button"
                disabled={gone}
                aria-pressed={sel}
                aria-label={d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}
                onClick={() => setDraft(at(d, draft.getHours(), draft.getMinutes()))}
                className={`mx-auto grid size-10 place-items-center rounded-full text-[14px] tabular-nums transition-colors disabled:opacity-25 ${
                  sel ? 'bg-btn font-medium text-on-btn' : today ? 'bg-accent/40 font-medium' : inMonth ? '' : 'text-fg-4'
                }`}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Select
            label="Hour"
            value={h12}
            onChange={(h) => setTime(h, draft.getMinutes(), pm)}
            options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
          />
          <Select
            label="Minute"
            value={draft.getMinutes() - (draft.getMinutes() % 5)}
            onChange={(m) => setTime(h12, m, pm)}
            options={Array.from({ length: 12 }, (_, i) => ({ value: i * 5, label: `:${String(i * 5).padStart(2, '0')}` }))}
          />
          <div role="radiogroup" aria-label="AM or PM" className="flex h-[50px] gap-1 rounded-2xl bg-muted p-1">
            {[false, true].map((p) => (
              <button
                key={String(p)}
                type="button"
                role="radio"
                aria-checked={pm === p}
                onClick={() => setTime(h12, draft.getMinutes(), p)}
                className={`w-12 rounded-xl text-[14px] font-medium ${pm === p ? 'bg-surface shadow-[var(--shadow-card)]' : 'text-fg-3'}`}
              >
                {p ? 'pm' : 'am'}
              </button>
            ))}
          </div>
        </div>

        {past && <p className="mt-3 text-[13px] text-fg-3">That time has passed. Pick a later one.</p>}
        <button
          type="button"
          disabled={past}
          onClick={() => {
            onChange(draft);
            setOpen(false);
          }}
          className="btn btn-primary mt-4 w-full"
        >
          Set {whenLabel(draft, now)}
        </button>
      </Sheet>
    </>
  );
}
