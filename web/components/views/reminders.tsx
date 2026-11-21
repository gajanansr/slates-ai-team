import { Repeat as RepeatIcon } from 'lucide-react';
import { NavBar } from '@/components/slate/nav-bar';
import { PageTransition } from '@/components/page-transition';
import { IllustrationPanel } from '@/components/illustrations';
import { AddReminder } from '@/components/reminders/add-reminder';
import { ReminderCheck } from '@/components/reminders/reminder-check';
import { ReminderRowActions } from '@/components/reminders/reminder-row-actions';
import { dayKey, timeLabel, type Reminder } from '@/lib/reminders';
import { AgendaWeek } from '@/components/agenda-week';
import type { AgendaItem } from '@/lib/agenda';

function groupLabel(r: Reminder, tz: string, now: Date) {
  if (new Date(r.due_at) <= now) return 'Overdue';
  const today = dayKey(now, tz);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), tz);
  const k = dayKey(r.due_at, tz);
  if (k === today) return 'Today';
  if (k === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(r.due_at));
}

export function RemindersView({ list, tz, now = new Date(), week = [], today = '' }: { list: Reminder[]; tz: string; now?: Date; week?: { day: string; items: AgendaItem[] }[]; today?: string }) {
  const open = list.filter((r) => !r.done_at).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const groups = new Map<string, Reminder[]>();
  for (const r of open) {
    const g = groupLabel(r, tz, now);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }

  return (
    <PageTransition>
      <NavBar title="Reminders" backHref="/home" backLabel="Back to Today">
        <header className="mb-5">
          <p className="kicker mb-2">{open.length} open · pushed to your phone</p>
          <h1 className="text-[32px] font-medium leading-[1.1] tracking-[-0.045em]">Don&apos;t hold it in your head.</h1>
        </header>
      </NavBar>

      <AgendaWeek days={week.filter((d) => d.items.some((i) => i.where !== 'Reminder'))} today={today} />
      <AddReminder />

      {open.length === 0 ? (
        <div className="mt-6 text-center">
          <IllustrationPanel name="bell" className="mb-4 h-[140px]" />
          <p className="text-[17px] font-medium tracking-tight">No reminders yet</p>
          <p className="mx-auto mt-1 max-w-[36ch] text-sm text-fg-3">
            Add one above, or tell an agent: &ldquo;remind me at 6pm to call the bank&rdquo;.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {[...groups.entries()].map(([label, rows]) => (
            <section key={label}>
              <h2 className={`mb-1 px-1 text-[20px] font-medium tracking-[-0.03em] ${label === 'Overdue' ? 'text-fg' : ''}`}>{label}</h2>
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3.5 py-3">
                    <ReminderCheck id={r.id} label={r.text} urgent={label === 'Overdue'} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15.5px] leading-snug">{r.text}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-fg-3">
                        {timeLabel(r.due_at, tz)}
                        {r.repeat && (
                          <>
                            <RepeatIcon className="size-3" strokeWidth={2} /> {r.repeat}
                          </>
                        )}
                        {r.created_by_name && <> · {r.created_by_name}</>}
                      </span>
                    </span>
                    <ReminderRowActions id={r.id} text={r.text} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PageTransition>
  );
}
