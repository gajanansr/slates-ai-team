import type { ChartData, Slate } from '@/lib/kinds';
import { fmt, latest } from '@/lib/chart-format';

/** One glanceable line for a board tile: a big stat plus a quiet label. */
export function summarize(s: Slate): { stat: string; label: string } {
  const d = s.data as Record<string, any>;
  const arr = (k: string) => (Array.isArray(d?.[k]) ? (d[k] as any[]) : []);
  switch (s.kind) {
    case 'brief': {
      const items = arr('items');
      const done = items.filter((i) => i.done).length;
      return { stat: `${done}/${items.length}`, label: 'done' };
    }
    case 'list': {
      const items = arr('items');
      const open = items.filter((i) => !i.done).length;
      if (items.length === 0) return { stat: '0', label: 'items' };
      return open === 0 ? { stat: 'All done', label: `${items.length} items` } : { stat: String(open), label: `of ${items.length} left` };
    }
    case 'links': {
      const n = arr('items').length;
      return { stat: String(n), label: n === 1 ? 'link' : 'links' };
    }
    case 'metrics': {
      const first = arr('items')[0];
      return first ? { stat: String(first.value), label: String(first.label) } : { stat: '–', label: 'no metrics' };
    }
    case 'timeline': {
      const first = arr('entries')[0];
      return first ? { stat: String(first.date), label: String(first.title ?? first.items?.[0] ?? 'latest') } : { stat: '–', label: 'empty' };
    }
    case 'table': {
      const n = arr('rows').length;
      return { stat: String(n), label: n === 1 ? 'row' : 'rows' };
    }
    case 'chart': {
      const c = s.data as unknown as ChartData;
      const l = latest(c);
      return l ? { stat: fmt(l.value, c), label: `${l.name} · ${l.label}` } : { stat: '–', label: 'no data' };
    }
    case 'dashboard': {
      const w = (d?.widgets ?? []) as { kind: string; title: string; data: any }[];
      const m = w.find((x) => x.kind === 'metrics')?.data?.items?.[0];
      return m ? { stat: String(m.value), label: `${m.label} · ${w.length} widgets` } : { stat: String(w.length), label: 'widgets' };
    }
    case 'markdown':
      return { stat: '', label: firstLine(String(d?.body ?? '')) || 'Empty note' };
    case 'notes': {
      const n = arr('items').length;
      return { stat: String(n), label: n === 1 ? 'note' : 'notes' };
    }
    case 'tracker': {
      const stages = arr('stages');
      const items = arr('items');
      const last = stages[stages.length - 1];
      const active = items.filter((i) => i.stage !== last?.id).length;
      return { stat: String(active), label: `active · ${items.length} total` };
    }
    case 'habits': {
      const items = arr('items');
      const best = items.map((h) => ({ h, s: streak(h.days ?? [], h.goal) })).sort((a, b) => b.s - a.s)[0];
      return best ? { stat: `${best.s}d`, label: `${best.h.name} streak` } : { stat: '0', label: 'habits' };
    }
    case 'goals': {
      const g = arr('items')[0];
      return g ? { stat: `${pct(g.current, g.target)}%`, label: String(g.title) } : { stat: '–', label: 'no goals' };
    }
    case 'countdown': {
      const next = upcoming(arr('items'))[0];
      return next ? { stat: daysLabel(daysUntil(next.date)), label: String(next.title) } : { stat: '–', label: 'nothing ahead' };
    }
  }
  return { stat: '', label: '' };
}

/** First readable line of Markdown, without heading/list/emphasis marks. */
export function firstLine(md: string) {
  return (
    md
      .split('\n')
      .map((l) => l.replace(/^[#>\-*+\s]+|^\d+\.\s+/g, '').replace(/[*_`]|\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
      .find(Boolean) ?? ''
  );
}

/** Updated by an agent in the last 24h. */
export function isFresh(s: Slate, now = Date.now()) {
  return Boolean(s.updated_by) && now - new Date(s.updated_at).getTime() < 86_400_000;
}

const KIND_GROUP: Record<Slate['kind'], string> = {
  brief: 'Briefs',
  list: 'Lists',
  links: 'Links',
  metrics: 'Numbers',
  timeline: 'Logs',
  table: 'Tables',
  markdown: 'Docs',
  notes: 'Notes',
  chart: 'Charts',
  dashboard: 'Dashboards',
  tracker: 'Trackers',
  habits: 'Habits',
  goals: 'Goals',
  countdown: 'Countdowns',
};

// ------------------------------------------------------------------ date helpers

/** Local YYYY-MM-DD for a timezone (defaults to the runtime's). */
export function today(tz?: string, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const dayMs = 86_400_000;
const toUtc = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(toUtc(day) + n * dayMs).toISOString().slice(0, 10);
const isWeekend = (day: string) => [0, 6].includes(new Date(toUtc(day)).getUTCDay());

/** Consecutive days done, ending today (or yesterday, if today isn't ticked yet). */
export function streak(days: string[], goal?: 'daily' | 'weekdays', tz?: string) {
  const set = new Set(days);
  let d = today(tz);
  if (!set.has(d)) d = addDays(d, -1);
  let n = 0;
  for (let i = 0; i < 800; i++) {
    if (goal === 'weekdays' && isWeekend(d)) {
      d = addDays(d, -1);
      continue;
    }
    if (!set.has(d)) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export const pct = (current: number, target: number) => Math.max(0, Math.min(100, Math.round((current / target) * 100)));

/** Whole days from today to a date (negative = past). */
export function daysUntil(date: string, tz?: string) {
  return Math.round((toUtc(date.slice(0, 10)) - toUtc(today(tz))) / dayMs);
}
export const daysLabel = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 0 ? `${n} days` : `${-n}d ago`);
export function upcoming<T extends { date: string }>(items: T[], tz?: string) {
  return [...items].filter((i) => daysUntil(i.date, tz) >= 0).sort((a, b) => a.date.localeCompare(b.date));
}

export const categoryOf = (s: Slate) => s.category?.trim() || KIND_GROUP[s.kind];
export const categorySlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Boards grouped by category, in the order the user arranged them; pinned first within a group. */
export function groupBoards(boards: Slate[]) {
  const groups = new Map<string, Slate[]>();
  for (const b of [...boards].sort((a, c) => a.position - c.position)) {
    const k = categoryOf(b);
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  return [...groups.entries()].map(([name, items]) => ({
    name,
    slug: categorySlug(name),
    boards: items.sort((a, c) => Number(c.pinned) - Number(a.pinned) || a.position - c.position),
  }));
}
