import { z } from 'zod';
import { ALL_KIND_SCHEMAS, COLLECTION_KEY, EXAMPLES, WIDGET_KINDS, WIDGET_SIZES, WIDGET_TEXT_MAX, validateData, ValidationError, type SlateKind } from '@/lib/kinds';
import { ICON_NAMES, isIconName } from '@/lib/icons';
import { VOICE_IDS, resolveVoice, voicePromptList } from '@/lib/voices';

/**
 * Agent Studio blueprints: what an agent "on demand" is made of. A goal ("manage my dairy
 * business") becomes a blueprint (name, look, boards, routines, reminders, notes, questions),
 * validated here against the same kind schemas every board write uses. Model output is
 * repaired first (ids, stages, column keys, lengths) and anything still invalid is dropped.
 * Pure: no server or database code, so it is safe to test and to import anywhere.
 */

/** Accent colours an agent may use. Each has a light and a dark value tuned for contrast in the UI. */
export const AGENT_COLORS = ['green', 'teal', 'blue', 'indigo', 'violet', 'rose', 'orange', 'amber'] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];

/** Board kinds an agent can be built from (the Notes board and the daily brief are shared, never per agent). */
export const BOARD_KINDS = ['dashboard', 'table', 'list', 'tracker', 'metrics', 'goals', 'habits', 'countdown', 'links', 'chart', 'timeline', 'markdown'] as const satisfies readonly SlateKind[];
type BoardKind = (typeof BOARD_KINDS)[number];
const BUILT_WIDGETS = WIDGET_KINDS.filter((k) => k !== 'note');

export const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export const LIMITS = { boards: 6, routines: 5, reminders: 4, notes: 3, questions: 3, widgets: 12 } as const;

export const ScheduleSchema = z.object({
  every: z.enum(['hourly', 'daily', 'weekly']),
  at_hour: z.number().int().min(0).max(23).nullable().optional(),
  at_weekday: z.number().int().min(0).max(6).nullable().optional().describe('0 = Sunday'),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

const RoutineSchema = z.object({
  title: z.string().min(1).max(80),
  schedule: ScheduleSchema,
  does: z.string().min(1).max(300),
  /** Set when an existing automation can run it: rss (a feed into a links board), brief, recap. */
  automation: z
    .object({
      kind: z.enum(['rss', 'brief', 'recap']),
      source: z.string().max(20).optional(),
      url: z.string().max(2048).optional(),
    })
    .optional(),
});

const ReminderSchema = z.object({
  text: z.string().min(1).max(200),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24-hour'),
  repeat: z.enum(REPEATS).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});

const BoardSchema = z
  .object({
    title: z.string().min(1).max(60),
    kind: z.enum(BOARD_KINDS),
    icon: z.enum(ICON_NAMES).optional(),
    purpose: z.string().max(140).optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .superRefine((b, ctx) => {
    try {
      validateData(b.kind, b.data);
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['data'], message: (e as Error).message.slice(0, 300) });
    }
  });

const NoteSchema = z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(4000) });

export const BlueprintSchema = z.object({
  name: z.string().min(2).max(24),
  icon: z.enum(ICON_NAMES),
  color: z.enum(AGENT_COLORS),
  /** Its Murf voice (lib/voices.ts). Optional only for blueprints made before voices; repair always sets one. */
  voice: z.enum(VOICE_IDS).optional(),
  mission: z.string().min(3).max(200),
  space: z.string().min(1).max(24),
  boards: z.array(BoardSchema).min(1).max(LIMITS.boards),
  routines: z.array(RoutineSchema).max(LIMITS.routines),
  reminders: z.array(ReminderSchema).max(LIMITS.reminders),
  notes: z.array(NoteSchema).max(LIMITS.notes),
  questions: z.array(z.string().min(3).max(140)).max(LIMITS.questions),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;
export type BlueprintBoard = Blueprint['boards'][number];
export type BlueprintRoutine = Blueprint['routines'][number];
export type BlueprintReminder = Blueprint['reminders'][number];

// ------------------------------------------------------------------ slugs

/** Lowercase letters, digits and dashes; same rule as categories. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const fit = (s: string, max: number) => s.slice(0, max).replace(/-+$/g, '');

/** Stable slug for an agent, from its name: "Dairy Manager" -> "dairy-manager". */
export const agentSlug = (name: string) => fit(slugify(name), 40) || 'agent';
/** The hidden board holding an agent's manifest. */
export const manifestSlug = (slug: string) => fit(`agent-${slug}`, 63);
/** A board that belongs to an agent: "dairy-manager-customers". `n` > 1 only when that slug is taken by something else. */
export const boardSlug = (slug: string, title: string, n = 1) => {
  const base = fit(`${slug}-${slugify(title) || 'board'}`, n > 1 ? 58 : 63);
  return n > 1 ? `${base}-${n}` : base;
};
/** The agent's "How it works" note (its playbook). */
export const playbookId = (slug: string) => fit(`agent-${slug}`, 64);
export const starterNoteId = (slug: string, title: string) => fit(`${slug}-${slugify(title) || 'note'}`, 64);

/** A colour from the name, so an agent without one still looks the same every time. */
export function colorFor(name: string): AgentColor {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}

// ------------------------------------------------------------------ schedules

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const two = (n: number) => String(n).padStart(2, '0');

export function describeSchedule(s: Schedule) {
  const at = s.at_hour ?? 9;
  const time = `${two(at)}:00`;
  if (s.every === 'hourly') return 'Every hour';
  if (s.every === 'weekly') return `Every ${WEEKDAY_NAMES[s.at_weekday ?? 1]} at ${time}`;
  return `Every day at ${time}`;
}

/** Wall-clock parts of an instant in a timezone. */
function partsIn(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)) };
}

/** The instant when the wall clock in `tz` reads y-m-d h:mi. */
function zoned(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(t), tz);
    t += Date.UTC(y, m - 1, d, h, mi) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return new Date(t);
}

/** Next local day (from today) matching `ok`, at h:mi in tz, strictly after now. */
function nextAt(tz: string, now: Date, h: number, mi: number, ok: (dow: number) => boolean) {
  const today = partsIn(now, tz);
  for (let i = 0; i < 40; i++) {
    const noon = new Date(Date.UTC(today.y, today.m - 1, today.d + i, 12));
    const dow = noon.getUTCDay();
    if (!ok(dow)) continue;
    const at = zoned(noon.getUTCFullYear(), noon.getUTCMonth() + 1, noon.getUTCDate(), h, mi, tz);
    if (at.getTime() > now.getTime()) return at;
  }
  return new Date(now.getTime() + 86_400_000);
}

/** When a routine next runs, in the automations' own schedule format. */
export function nextRun(s: Schedule, tz: string, now = new Date()): Date {
  if (s.every === 'hourly') {
    const t = new Date(now);
    t.setUTCMinutes(0, 0, 0);
    return new Date(t.getTime() + 3_600_000);
  }
  const h = s.at_hour ?? 9;
  if (s.every === 'weekly') return nextAt(tz, now, h, 0, (dow) => dow === (s.at_weekday ?? 1));
  return nextAt(tz, now, h, 0, () => true);
}

/** First time a blueprint reminder fires, as a Date (format it with the user's offset when sending). */
export function firstReminderAt(r: BlueprintReminder, tz: string, now = new Date()): Date {
  const [h, mi] = r.time.split(':').map(Number);
  if (r.repeat === 'weekdays') return nextAt(tz, now, h, mi, (dow) => dow >= 1 && dow <= 5);
  if (r.repeat === 'weekly' && r.weekday !== undefined) return nextAt(tz, now, h, mi, (dow) => dow === r.weekday);
  // daily, monthly (repeats from the first time) and one-off: the next time the clock reads h:mi.
  return nextAt(tz, now, h, mi, () => true);
}

// ------------------------------------------------------------------ repair

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const PICTO = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Emoji are never used in Slates: strip them from every string, deep. */
function stripEmoji<T>(v: T): T {
  if (typeof v === 'string') return v.replace(PICTO, '').replace(/[ \t]{2,}/g, ' ').trim() as T;
  if (Array.isArray(v)) return v.map(stripEmoji) as T;
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripEmoji(x)])) as T;
  return v;
}

const text = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const words = (v: unknown, max: number) => {
  const s = text(v, 200);
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1).replace(/\s+\S*$/, '');
  return (cut || s.slice(0, max)).trim();
};
const idOf = (v: unknown, i: number, prefix = 'i') => fit(slugify(text(v, 80)), 48) || `${prefix}${i + 1}`;
const uniq = (ids: Set<string>, id: string) => {
  let out = id;
  for (let n = 2; ids.has(out); n++) out = `${id}-${n}`;
  ids.add(out);
  return out;
};
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.\-]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const safeHref = (v: unknown) => (typeof v === 'string' && /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(v) && v.length <= 2048 ? v : undefined);

/** Shortest caps across kinds for common item fields, so an over-long field is trimmed instead of dropping the item. */
const FIELD_CAPS: Record<string, number> = { text: 500, title: 120, detail: 300, meta: 120, label: 80, value: 60, sub: 200, name: 40, unit: 16, prefix: 6, date: 40 };

function tidyItem(raw: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'files' || v === null || v === undefined) continue; // attachments are set by the app
    if (k === 'href' || k === 'url') {
      const h = safeHref(v);
      if (h) out[k] = h;
      continue;
    }
    out[k] = typeof v === 'string' && FIELD_CAPS[k] ? v.slice(0, FIELD_CAPS[k]).trim() : v;
  }
  return out;
}

function repairItems(kind: BoardKind, items: unknown, base: Record<string, unknown>): Record<string, any>[] {
  if (!Array.isArray(items)) return [];
  const ids = new Set<string>();
  const out: Record<string, any>[] = [];
  items.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const it = tidyItem(raw);
    const label = it.id ?? it.title ?? it.text ?? it.name ?? it.label ?? it.date;
    it.id = uniq(ids, idOf(label, i));
    switch (kind) {
      case 'list':
        it.text = text(it.text ?? it.title ?? it.name, 500);
        delete it.title;
        if (typeof it.done !== 'boolean') delete it.done;
        break;
      case 'metrics':
        it.label = text(it.label ?? it.title ?? it.name, 80);
        it.value = text(it.value ?? '—', 60) || '—';
        if (it.progress !== undefined) {
          const p = num(it.progress);
          if (p === null) delete it.progress;
          else it.progress = Math.max(0, Math.min(100, p));
        }
        if (it.trend !== undefined) {
          const t = Array.isArray(it.trend) ? it.trend.map(num).filter((x: number | null): x is number => x !== null) : [];
          if (t.length >= 2) it.trend = t.slice(-24);
          else delete it.trend;
        }
        break;
      case 'goals': {
        it.title = text(it.title ?? it.name, 120);
        it.current = num(it.current) ?? 0;
        it.target = num(it.target);
        if (!it.target) return;
        if (it.deadline !== undefined && !isoDay(it.deadline)) delete it.deadline;
        break;
      }
      case 'habits':
        it.name = text(it.name ?? it.title, 80);
        it.days = []; // never invent a history
        if (it.goal !== 'daily' && it.goal !== 'weekdays') delete it.goal;
        break;
      case 'countdown':
        it.title = text(it.title ?? it.name, 120);
        if (!isoDay(it.date) && !(typeof it.date === 'string' && !Number.isNaN(Date.parse(it.date)) && /T/.test(it.date))) return;
        break;
      case 'links':
        it.title = text(it.title ?? it.name, 200);
        if (!it.url) return;
        break;
      case 'timeline':
        it.date = text(it.date, 40) || 'Today';
        it.items = (Array.isArray(it.items) ? it.items : [it.text ?? it.title]).map((x: unknown) => text(x, 1000)).filter(Boolean).slice(0, 100);
        break;
      case 'table': {
        const keys = new Set(((base.columns as { key: string }[]) ?? []).map((c) => c.key));
        const src = isObj(it.cells) ? it.cells : it;
        const cells: Record<string, string> = {};
        for (const k of keys) if (src[k] !== undefined && src[k] !== null) cells[k] = text(src[k], 1000);
        if (!Object.keys(cells).length) return;
        out.push({ id: it.id, cells });
        return;
      }
      case 'tracker': {
        const stages = (base.stages as { id: string; name: string }[]) ?? [];
        const s = String(it.stage ?? '');
        const hit = stages.find((x) => x.id === s) ?? stages.find((x) => x.name.toLowerCase() === s.toLowerCase());
        it.title = text(it.title ?? it.text ?? it.name, 200);
        it.stage = (hit ?? stages[0])?.id;
        if (it.due !== undefined && !isoDay(it.due)) delete it.due;
        break;
      }
    }
    out.push(it);
  });
  // Keep each item only if it passes the kind's own schema on its own.
  const key = COLLECTION_KEY[kind]!;
  return out.filter((it) => ALL_KIND_SCHEMAS[kind].safeParse({ ...base, [key]: [it] }).success);
}

/** Bring model output for one kind into shape. Returns null when nothing usable is left. */
export function repairKindData(kind: BoardKind, data: unknown, opts: { widget?: boolean } = {}): Record<string, unknown> | null {
  if (!isObj(data)) return null;
  let out: Record<string, unknown>;
  switch (kind) {
    case 'markdown': {
      const body = typeof data.body === 'string' ? data.body : '';
      if (!body.trim()) return null;
      out = { body: body.slice(0, opts.widget ? WIDGET_TEXT_MAX : 50000) };
      break;
    }
    case 'dashboard': {
      const ids = new Set<string>();
      const widgets: Record<string, unknown>[] = [];
      for (const [i, w] of (Array.isArray(data.widgets) ? data.widgets : []).entries()) {
        if (!isObj(w) || !(BUILT_WIDGETS as readonly string[]).includes(w.kind)) continue;
        const wd = repairKindData(w.kind as BoardKind, w.data, { widget: true });
        if (!wd) continue;
        const widget: Record<string, unknown> = { id: idOf(w.id ?? w.title, i, 'w'), title: text(w.title, 60) || w.kind, kind: w.kind, data: wd };
        if ((WIDGET_SIZES as readonly string[]).includes(w.size)) widget.size = w.size;
        if (!ALL_KIND_SCHEMAS.dashboard.safeParse({ widgets: [widget] }).success) continue;
        widget.id = uniq(ids, String(widget.id));
        widgets.push(widget);
        if (widgets.length >= LIMITS.widgets) break;
      }
      if (!widgets.length) return null;
      out = { widgets, ...(text(data.summary, 200) ? { summary: text(data.summary, 200) } : {}) };
      break;
    }
    case 'table': {
      const keys = new Set<string>();
      const columns = (Array.isArray(data.columns) ? data.columns : [])
        .filter(isObj)
        .map((c, i) => {
          const label = text(c.label ?? c.key, 60) || `Column ${i + 1}`;
          const key = uniq(keys, (String(c.key ?? '').match(/^[A-Za-z0-9_-]{1,40}$/) ? String(c.key) : fit(slugify(label), 40)) || `c${i + 1}`);
          return { key, label, ...(c.align === 'end' || c.align === 'start' ? { align: c.align } : {}) };
        })
        .slice(0, 12);
      if (!columns.length) return null;
      out = { columns, rows: repairItems('table', data.rows, { columns }) };
      break;
    }
    case 'tracker': {
      const ids = new Set<string>();
      const stages = (Array.isArray(data.stages) ? data.stages : [])
        .map((s: unknown, i: number) => {
          const name = text(isObj(s) ? s.name ?? s.title ?? s.id : s, 40);
          return name ? { id: uniq(ids, idOf(isObj(s) ? s.id ?? name : name, i, 's')), name } : null;
        })
        .filter(Boolean)
        .slice(0, 8) as { id: string; name: string }[];
      if (!stages.length) return null;
      out = { stages, items: repairItems('tracker', data.items, { stages }) };
      break;
    }
    case 'chart': {
      const labels = (Array.isArray(data.labels) ? data.labels : []).map((l: unknown) => text(l, 24)).filter(Boolean).slice(0, 60);
      if (!labels.length) return null;
      const ids = new Set<string>();
      const series = (Array.isArray(data.series) ? data.series : [])
        .filter(isObj)
        .slice(0, 4)
        .map((s, i) => {
          const values = (Array.isArray(s.values) ? s.values : []).map(num).slice(0, labels.length);
          while (values.length < labels.length) values.push(null);
          return { id: uniq(ids, idOf(s.id ?? s.name, i, 's')), name: text(s.name, 40) || `Series ${i + 1}`, values };
        });
      if (!series.length) return null;
      let type = ['bar', 'line', 'area', 'parts'].includes(data.type) ? data.type : 'bar';
      if (type === 'parts' && (series.length !== 1 || labels.length > 5 || series[0].values.some((v: number | null) => v !== null && v < 0))) type = 'bar';
      out = { type, labels, series };
      for (const k of ['prefix', 'suffix', 'caption'] as const) if (typeof data[k] === 'string') out[k] = data[k].slice(0, k === 'caption' ? 140 : k === 'prefix' ? 6 : 8);
      break;
    }
    default: {
      const key = COLLECTION_KEY[kind] as string;
      out = { [key]: repairItems(kind, data[key] ?? data.items, {}) };
      if (kind === 'metrics' && typeof data.asOf === 'string') out.asOf = data.asOf.slice(0, 60);
    }
  }
  const key = COLLECTION_KEY[kind];
  // An empty table, tracker or list is fine (the user fills it); empty tiles or a widget with nothing in it are not.
  if (key && key !== 'widgets' && (out[key] as unknown[]).length === 0 && (opts.widget || ['metrics', 'goals', 'habits', 'countdown', 'links', 'timeline'].includes(kind))) return null;
  const parsed = (opts.widget ? ALL_KIND_SCHEMAS.dashboard.safeParse({ widgets: [{ id: 'x', title: 'x', kind, data: out }] }) : ALL_KIND_SCHEMAS[kind].safeParse(out)).success;
  if (!parsed) return null;
  if (!opts.widget) {
    try {
      validateData(kind, out);
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * Turn whatever the model returned into a valid blueprint: unknown icons and colours get a
 * safe default, boards are repaired item by item (or dropped), lists are capped. Throws
 * ValidationError only when no usable board is left.
 */
export function repairBlueprint(input: unknown, goal = '', opts: { timezone?: string } = {}): { blueprint: Blueprint; repairs: string[] } {
  const repairs: string[] = [];
  const raw = stripEmoji(isObj(input) ? input : {});
  const name = words(raw.name, 24) || words(goal.replace(/^(please\s+)?(help me\s+|can you\s+)?/i, ''), 24) || 'My Agent';
  const icon = isIconName(raw.icon) ? raw.icon : 'sparkles';
  if (icon !== raw.icon) repairs.push(`icon "${text(raw.icon, 30)}" is not in the list; used sparkles`);
  const color = (AGENT_COLORS as readonly string[]).includes(raw.color) ? (raw.color as AgentColor) : colorFor(name);
  const voice = resolveVoice(raw.voice, opts.timezone);
  if (raw.voice !== undefined && voice !== raw.voice) repairs.push(`voice "${text(raw.voice, 30)}" is not in the list; used ${voice}`);

  const boards: BlueprintBoard[] = [];
  for (const [i, b] of (Array.isArray(raw.boards) ? raw.boards : []).entries()) {
    if (!isObj(b)) continue;
    const title = words(b.title, 60) || `Board ${i + 1}`;
    if (!(BOARD_KINDS as readonly string[]).includes(b.kind)) {
      repairs.push(`dropped "${title}": unknown kind "${text(b.kind, 20)}"`);
      continue;
    }
    if (boards.some((x) => slugify(x.title) === slugify(title))) {
      repairs.push(`dropped duplicate board "${title}"`);
      continue;
    }
    const data = repairKindData(b.kind, b.data);
    if (!data) {
      repairs.push(`dropped "${title}": its ${b.kind} data was not usable`);
      continue;
    }
    boards.push({ title, kind: b.kind, data, ...(isIconName(b.icon) ? { icon: b.icon } : {}), ...(text(b.purpose, 140) ? { purpose: text(b.purpose, 140) } : {}) });
    if (boards.length >= LIMITS.boards) break;
  }
  if (!boards.length) throw new ValidationError('The blueprint had no usable boards.', repairs);

  const routines = (Array.isArray(raw.routines) ? raw.routines : [])
    .filter(isObj)
    .map((r) => {
      const s = isObj(r.schedule) ? r.schedule : r;
      const every = ['hourly', 'daily', 'weekly'].includes(s.every) ? s.every : 'daily';
      const hour = num(s.at_hour);
      const day = num(s.at_weekday);
      const schedule: Schedule = { every, at_hour: every === 'hourly' ? null : hour !== null ? Math.max(0, Math.min(23, Math.round(hour))) : 9, at_weekday: every === 'weekly' ? (day !== null ? Math.max(0, Math.min(6, Math.round(day))) : 1) : null };
      const a = isObj(r.automation) ? r.automation : null;
      const automation =
        a && ['brief', 'recap'].includes(a.kind) ? { kind: a.kind } : a && a.kind === 'rss' && (text(a.url, 2048) || text(a.source, 20)) ? { kind: 'rss' as const, ...(text(a.url, 2048) ? { url: text(a.url, 2048) } : {}), ...(text(a.source, 20) ? { source: text(a.source, 20) } : {}) } : undefined;
      return { title: words(r.title, 80), schedule, does: text(r.does ?? r.description ?? r.what, 300), ...(automation ? { automation } : {}) } as BlueprintRoutine;
    })
    .filter((r) => r.title && r.does)
    .slice(0, LIMITS.routines);

  const reminders = (Array.isArray(raw.reminders) ? raw.reminders : [])
    .filter(isObj)
    .map((r) => {
      const t = String(r.time ?? '').match(/^(\d{1,2}):(\d{2})/);
      const time = t && +t[1] < 24 && +t[2] < 60 ? `${two(+t[1])}:${t[2]}` : '09:00';
      const wd = num(r.weekday);
      return {
        text: text(r.text ?? r.title, 200),
        time,
        ...((REPEATS as readonly string[]).includes(r.repeat) ? { repeat: r.repeat } : {}),
        ...(wd !== null && wd >= 0 && wd <= 6 ? { weekday: Math.round(wd) } : {}),
      } as BlueprintReminder;
    })
    .filter((r) => r.text)
    .slice(0, LIMITS.reminders);

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter(isObj)
    .map((n) => ({ title: text(n.title, 120), body: typeof n.body === 'string' ? n.body.slice(0, 4000).trim() : '' }))
    .filter((n) => n.title && n.body)
    .slice(0, LIMITS.notes);

  const questions = (Array.isArray(raw.questions) ? raw.questions : []).map((q: unknown) => text(q, 140)).filter((q: string) => q.length >= 3).slice(0, LIMITS.questions);

  const blueprint = BlueprintSchema.parse({
    name,
    icon,
    color,
    voice,
    mission: text(raw.mission, 200) || `Helps you ${goal.trim().slice(0, 180) || 'stay on top of things'}.`,
    space: words(raw.space, 24) || name,
    boards,
    routines,
    reminders,
    notes,
    questions,
  });
  return { blueprint, repairs };
}

// ------------------------------------------------------------------ prompt

const SHOWN_KINDS: BoardKind[] = ['dashboard', 'table', 'list', 'tracker', 'goals', 'habits', 'countdown', 'links', 'chart', 'metrics'];

/** Instructions for the model. The kind examples come from lib/kinds so they never drift. */
export function blueprintPrompt() {
  const kinds = SHOWN_KINDS.map((k) => `- ${k}: ${JSON.stringify(EXAMPLES[k])}`).join('\n');
  return `You design "agents" for Slates, a personal dashboard app read on a phone. An agent is a small set of boards, routines, reminders and notes that together run one job for the user. Reply with ONE JSON object and nothing else.

Shape:
{
  "name": "2-3 words, a role, e.g. \\"Dairy Manager\\" (max 24 chars)",
  "icon": one of ${JSON.stringify(ICON_NAMES)},
  "color": one of ${JSON.stringify(AGENT_COLORS)},
  "voice": the id of the voice it speaks with, one of: ${voicePromptList()}. Match the role and tone, and the user's region: an Indian English (en-IN) voice when their timezone is in India, otherwise American or British English,
  "mission": "one sentence, what it does for the user",
  "space": "the agent's name again (its boards are grouped under it)",
  "boards": [ 3-5 boards: { "title", "kind", "icon" (from the list), "purpose": "one short line", "data": data in that kind's format } ],
  "routines": [ 2-4: { "title", "schedule": { "every": "hourly"|"daily"|"weekly", "at_hour": 0-23, "at_weekday": 0-6 (0 = Sunday, weekly only) }, "does": "what it does each time, one or two sentences", "automation": optional, only { "kind": "rss", "url": "<a real public feed or website>" } for following a news or deals feed } ],
  "reminders": [ 1-3: { "text": "short", "time": "HH:MM", "repeat": "daily"|"weekdays"|"weekly"|"monthly", "weekday": 0-6 for weekly } ],
  "notes": [ 1-2 starter notes: { "title", "body": Markdown with short sections and "- [ ]" checklists } ],
  "questions": [ up to 3 short questions that would let the agent personalise itself (numbers, names of things, preferences) ]
}

Board kinds and their data format (examples):
${kinds}
A dashboard holds 2-6 widgets; each widget is { "id", "title", "kind" (metrics, table, list, tracker, goals, habits, countdown, chart, links), "size": "s"|"m"|"l"|"xl", "data" }.

Make it excellent:
- Lead with ONE dashboard: metrics tiles first (the 3-5 numbers this job lives by, with a "sub" line saying what each means), then the most useful table or list.
- Be domain-smart and specific. For a dairy business that means milk collection per session, delivery routes, customers with litres per day and dues, feed stock, cattle health and vet visits; for fitness, workouts, body measurements and habits; for a launch, a task tracker with stages, channels and a countdown.
- Use the right kind: table for records with columns, tracker for things that move through stages, list for daily tasks, goals for targets, habits for daily check-offs, countdown for dated deadlines.
- Never invent personal data: no real names, phone numbers, addresses or real prices for the user. Example rows are clearly marked, e.g. "Customer A (example)", "Route 1 (example)", and live numbers start at "0" or "—" with a sub line like "log today's collection".
- 1-3 example rows per table or list, enough to show how to fill it. Habits have "days": [].
- Units and currency to suit the user's region (given below). Plain text only, no emoji.
- Ids are short lowercase slugs, unique within each board.`;
}

export function blueprintRequest(goal: string, details: string | undefined, ctx: { timezone: string; today: string }) {
  return `What the user wants: ${goal.trim().slice(0, 500)}${details?.trim() ? `\nMore details: ${details.trim().slice(0, 1500)}` : ''}\nTheir timezone: ${ctx.timezone}. Today: ${ctx.today}.\nDesign the agent now. JSON only.`;
}

/** Pull the first JSON object out of a model reply (handles code fences and chatter around it). */
export function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const src = fenced ?? reply;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ValidationError('The model did not return JSON.');
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    throw new ValidationError('The model returned JSON that could not be read.');
  }
}
