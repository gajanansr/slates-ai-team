import Link from 'next/link';
import { AlarmClock, Repeat as RepeatIcon } from 'lucide-react';
import { ItemCheck } from '@/components/slate/item-check';
import { InlineText } from '@/components/ui/inline-text';
import { plainText } from '@/lib/inline';
import { ReminderCheck } from '@/components/reminders/reminder-check';
import { timeLabel, type Reminder } from '@/lib/reminders';
import type { BriefData, Slate } from '@/lib/kinds';

type Row =
  | { kind: 'brief'; id: string; text: string; tone?: string }
  | { kind: 'reminder'; r: Reminder; overdue: boolean };

/**
 * Everything still open today: overdue reminders, the brief's undone items, then
 * the rest of today's reminders by time. Done items drop off.
 */
export function TodayList({ brief, todays, tz, now = new Date(), max, moreHref }: { brief?: Slate; todays: Reminder[]; tz: string; now?: Date; /** Show at most this many; the rest sit behind a link. */ max?: number; moreHref?: string }) {
  const items = ((brief?.data as BriefData | undefined)?.items ?? []).filter((i) => !i.done);
  const overdue = todays.filter((r) => new Date(r.due_at) <= now);
  const later = todays.filter((r) => new Date(r.due_at) > now);
  const rows: Row[] = [
    ...overdue.map((r) => ({ kind: 'reminder' as const, r, overdue: true })),
    ...items.map((i) => ({ kind: 'brief' as const, id: i.id, text: i.text, tone: i.tone })),
    ...later.map((r) => ({ kind: 'reminder' as const, r, overdue: false })),
  ];

  if (rows.length === 0) {
    return <p className="py-1 text-[14px] text-fg-2">All clear for today.</p>;
  }

  // Capped (on Today): the most pressing few in order, and a link to the rest.
  if (max !== undefined && rows.length > max) {
    const rest = rows.length - max;
    return (
      <ul className="space-y-0.5">
        {rows.slice(0, max).map(renderRow)}
        <li className="pt-1">
          <Link href={moreHref ?? '/reminders'} className="inline-flex h-8 items-center rounded-full bg-muted px-3 text-[13px] font-medium text-fg-2 active:scale-95">
            {rest} more
          </Link>
        </li>
      </ul>
    );
  }

  const reminderRows = rows.filter((r) => r.kind === 'reminder');
  const briefRows = rows.filter((r) => r.kind === 'brief');
  const label = (t: string) => <li className="kicker !text-[10px] pb-0.5 pt-1.5 !text-on-hero-2">{t}</li>;
  return (
    <ul className="space-y-0.5">
      {reminderRows.length > 0 && briefRows.length > 0 && label('Reminders')}
      {reminderRows.map(renderRow)}
      {reminderRows.length > 0 && briefRows.length > 0 && label('From your brief')}
      {briefRows.map(renderRow)}
    </ul>
  );

  function renderRow(row: Row) {
    return row.kind === 'brief' ? (
      <li key={`b-${row.id}`} className="flex items-start gap-3 py-1.5 [&>button]:mt-[-7px]">
        <ItemCheck slug={brief!.slug} id={row.id} done={false} label={plainText(row.text)} tone={row.tone} />
        <span className="min-w-0 flex-1 text-[14px] leading-snug text-fg"><InlineText text={row.text} /></span>
      </li>
    ) : (
      <li key={`r-${row.r.id}`} className="flex items-start gap-3 py-1.5 [&>button]:mt-[-7px]">
        <ReminderCheck id={row.r.id} label={row.r.text} urgent={row.overdue} />
        <span className="min-w-0 flex-1 text-[14px] leading-snug text-fg">{row.r.text}</span>
        <span
          className={`flex h-6 flex-none items-center gap-1 rounded-full px-2 text-[11.5px] font-medium ${
            row.overdue ? 'bg-accent text-on-accent' : 'bg-muted text-fg-2'
          }`}
        >
          {row.r.repeat ? <RepeatIcon className="size-3" strokeWidth={2} /> : <AlarmClock className="size-3" strokeWidth={2} />}
          {row.overdue ? 'Now' : timeLabel(row.r.due_at, tz)}
        </span>
      </li>
    );
  }
}
