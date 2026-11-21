import { exec, type Caller } from '@/lib/slates';

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type Reminder = {
  id: string;
  text: string;
  due_at: string;
  tz: string;
  repeat: Repeat | null;
  slate_slug: string | null;
  notify_at: string | null;
  sent_at: string | null;
  done_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

const R = 'reminders_exec';

export const reminders = {
  list: (c: Caller, opts: { include_done?: boolean; limit?: number } = {}) => exec<Reminder[]>(c, 'list', opts, R),
  context: (c: Caller) => exec<{ now: string; timezone: string }>(c, 'context', {}, R),
  create: (c: Caller, input: { text: string; at: string; repeat?: Repeat; slug?: string; timezone?: string }) =>
    exec<Reminder>(c, 'create', input, R),
  complete: (c: Caller, id: string) => exec<Reminder>(c, 'complete', { id }, R),
  snooze: (c: Caller, id: string, minutes: number) => exec<Reminder>(c, 'snooze', { id, minutes }, R),
  cancel: (c: Caller, id: string) => exec<{ cancelled: string }>(c, 'cancel', { id }, R),
};

/** Local calendar day key (YYYY-MM-DD) for an instant in a timezone. */
export function dayKey(iso: string | Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function timeLabel(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Overdue + due today (in the user's timezone), soonest first. */
export function todaysReminders(list: Reminder[], tz: string, now = new Date()) {
  const today = dayKey(now, tz);
  return list
    .filter((r) => !r.done_at && (new Date(r.due_at) <= now || dayKey(r.due_at, tz) === today))
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
}
