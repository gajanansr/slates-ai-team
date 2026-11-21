import type { Slate } from '@/lib/kinds';
import { dayKey, type Reminder } from '@/lib/reminders';

/** Everything dated in the next 7 days: calendar events, countdowns, tracker due dates, reminders. */
export type AgendaItem = { key: string; day: string; time?: string; title: string; where: string; href: string };

export function agenda(all: Slate[], reminders: Reminder[], tz: string, now = new Date(), days = 7): { day: string; items: AgendaItem[] }[] {
  const start = dayKey(now, tz);
  const end = dayKey(new Date(now.getTime() + (days - 1) * 86_400_000), tz);
  const inRange = (d: string) => d >= start && d <= end;
  const out: AgendaItem[] = [];
  const timeOf = (iso: string) => (iso.length > 10 ? new Intl.DateTimeFormat('en', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : undefined);

  for (const s of all) {
    if (s.archived_at) continue;
    const d = s.data as any;
    if (s.kind === 'countdown')
      for (const it of d.items ?? []) {
        const k = String(it.date).length > 10 ? dayKey(it.date, tz) : String(it.date);
        if (inRange(k)) out.push({ key: `${s.slug}/${it.id}`, day: k, time: timeOf(String(it.date)), title: it.title, where: s.title, href: `/s/${s.slug}` });
      }
    if (s.kind === 'tracker')
      for (const it of d.items ?? []) if (it.due && inRange(it.due)) out.push({ key: `${s.slug}/${it.id}`, day: it.due, title: it.title, where: s.title, href: `/s/${s.slug}` });
    if (s.kind === 'dashboard')
      for (const w of d.widgets ?? [])
        if (w.kind === 'countdown')
          for (const it of w.data?.items ?? []) {
            const k = String(it.date).slice(0, 10);
            if (inRange(k)) out.push({ key: `${s.slug}/${w.id}/${it.id}`, day: k, title: it.title, where: s.title, href: `/s/${s.slug}` });
          }
  }
  for (const r of reminders) {
    if (r.done_at) continue;
    const k = dayKey(r.due_at, tz);
    if (inRange(k)) out.push({ key: `r/${r.id}`, day: k, time: timeOf(r.due_at), title: r.text, where: 'Reminder', href: '/reminders' });
  }
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of out.sort((a, b) => (a.day + (a.time ? '1' : '0')).localeCompare(b.day + (b.time ? '1' : '0')))) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]);
  return [...byDay.entries()].map(([day, items]) => ({ day, items }));
}
