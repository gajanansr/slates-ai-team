import { z } from 'zod';

/**
 * Slate kinds: the typed building blocks agents compose a dashboard from.
 * Each kind has a data schema (validated before any write) and, when it holds a
 * collection, the key of that collection so items can be patched by id.
 */

const id = z.string().min(1).max(64).describe('Stable item id, unique within the slate. Reuse it to update the item.');
const short = (max: number) => z.string().max(max);
/** Only web and mail links: never javascript:, data: or other schemes that could run code. */
const safeUrl = z.url({ protocol: /^(https?|mailto)$/, error: 'URL must start with http://, https:// or mailto:' }).max(2048);

export const Tone = z
  .enum(['neutral', 'good', 'warn', 'bad'])
  .describe('Emphasis. Rendered as monochrome intensity: good = calm, warn = strong, bad = strongest.');

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const FileRef = z.object({
  path: z.string().max(300).describe('Storage path from an upload (set by the app).'),
  name: short(200),
  type: short(100).optional(),
  size: z.number().int().min(0).optional(),
});

const BriefItem = z.object({
  id,
  text: short(500).min(1),
  tone: Tone.optional(),
  done: z.boolean().optional(),
});
const ListItem = z.object({
  id,
  text: short(500).min(1),
  detail: short(1000).optional(),
  meta: short(120).optional().describe('Short right-aligned value, e.g. a date or amount.'),
  tone: Tone.optional(),
  done: z.boolean().optional(),
  href: safeUrl.optional(),
  files: z.array(FileRef).max(10).optional().describe('Attached images/PDFs (set by the app).'),
});
const LinkItem = z.object({
  id,
  title: short(200).min(1),
  url: safeUrl,
  detail: short(500).optional(),
});
const MetricItem = z.object({
  id,
  label: short(80).min(1),
  value: short(60),
  sub: short(200).optional(),
  tone: Tone.optional(),
  progress: z.number().min(0).max(100).optional().describe('0-100, renders a progress bar.'),
  trend: z.array(z.number()).min(2).max(24).optional().describe('Recent values, oldest first; renders a sparkline. Last point is the current value.'),
  href: safeUrl.optional().describe('Optional link: tapping the tile opens it (e.g. the bill to pay).'),
});
const TimelineEntry = z.object({
  id,
  date: short(40),
  title: short(200).optional(),
  items: z.array(short(1000)).max(100),
});
const TableColumn = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  label: short(60),
  align: z.enum(['start', 'end']).optional(),
});
const TableRow = z.object({
  id,
  cells: z.record(z.string(), short(1000)).describe('Map of column key -> cell text.'),
});

const NoteItem = z.object({
  id,
  title: short(120).min(1),
  body: z.string().max(20000).describe('Markdown.'),
  tags: z.array(z.string().min(1).max(24)).max(8).optional(),
  pinned: z.boolean().optional(),
  updated_at: z.iso.datetime({ offset: true }).optional(),
  by: short(60).optional().describe('Who last wrote it (set by the server).'),
});

const TrackerStage = z.object({ id, name: short(40).min(1) });
const TrackerItem = z.object({
  id,
  title: short(200).min(1),
  stage: z.string().min(1).max(64).describe('A stage id from stages.'),
  detail: short(1000).optional(),
  meta: short(120).optional(),
  href: safeUrl.optional(),
  due: isoDay.optional().describe('Due date, YYYY-MM-DD. Shows on the Agenda.'),
});
const TrackerData = z
  .object({
    stages: z.array(TrackerStage).min(1).max(8).describe('Columns in order, e.g. Applied, Interview, Offer.'),
    items: z.array(TrackerItem).max(500),
  })
  .superRefine((d, ctx) => {
    const ids = new Set(d.stages.map((s) => s.id));
    d.items.forEach((it, i) => {
      if (!ids.has(it.stage)) ctx.addIssue({ code: 'custom', path: ['items', i, 'stage'], message: `unknown stage "${it.stage}"` });
    });
  });

const Habit = z.object({
  id,
  name: short(80).min(1),
  days: z.array(isoDay).max(800).describe('Days the habit was done (YYYY-MM-DD, the user\'s timezone).'),
  goal: z.enum(['daily', 'weekdays']).optional().describe('Streaks skip weekends for "weekdays". Default daily.'),
});

const Goal = z.object({
  id,
  title: short(120).min(1),
  current: z.number(),
  target: z.number().refine((n) => n !== 0, 'target cannot be 0'),
  unit: short(16).optional().describe('e.g. "km", "books".'),
  prefix: short(6).optional().describe('e.g. "₹".'),
  deadline: isoDay.optional(),
  detail: short(300).optional(),
});

const CountdownItem = z.object({
  id,
  title: short(120).min(1),
  date: z.union([isoDay, z.iso.datetime({ offset: true })]).describe('YYYY-MM-DD or an ISO date-time.'),
  detail: short(300).optional(),
  href: safeUrl.optional(),
});

const ChartSeries = z.object({
  id,
  name: short(40).min(1),
  values: z.array(z.number().nullable()).max(60).describe('One value per label (null = gap).'),
});

const ChartData = z
  .object({
    type: z
      .enum(['bar', 'line', 'area', 'parts'])
      .describe('bar: compare categories or periods. line/area: change over time. parts: shares of one whole (use instead of pie/donut; one series, up to 5 parts).'),
    labels: z.array(short(24)).min(1).max(60).describe('X-axis categories or periods, in order.'),
    series: z
      .array(ChartSeries)
      .min(1, 'at least one series')
      .max(4, 'at most 4 series: fold the rest into "Other" or make several charts')
      .describe('1-4 series. More than 4: fold the rest into "Other" or make several charts.'),
    prefix: short(6).optional().describe('Value prefix, e.g. "₹" or "$".'),
    suffix: short(8).optional().describe('Value suffix, e.g. "%" or " kg".'),
    highlight: z.number().int().min(0).optional().describe('Index of the label to emphasise (single-series bar).'),
    caption: short(140).optional().describe('One line under the chart, e.g. what changed.'),
  })
  .superRefine((d, ctx) => {
    d.series.forEach((s, i) => {
      if (s.values.length !== d.labels.length) {
        ctx.addIssue({ code: 'custom', path: ['series', i, 'values'], message: `needs ${d.labels.length} values (one per label), got ${s.values.length}` });
      }
    });
    if (d.type === 'parts') {
      if (d.series.length !== 1) ctx.addIssue({ code: 'custom', path: ['series'], message: 'parts takes exactly one series' });
      if (d.labels.length > 5) ctx.addIssue({ code: 'custom', path: ['labels'], message: 'parts takes at most 5 labels; fold the rest into "Other"' });
      if (d.series[0]?.values.some((v) => v !== null && v < 0)) ctx.addIssue({ code: 'custom', path: ['series', 0, 'values'], message: 'parts values must be >= 0' });
    }
    if (d.highlight !== undefined && d.highlight >= d.labels.length) {
      ctx.addIssue({ code: 'custom', path: ['highlight'], message: 'highlight must be a label index' });
    }
  });

export const KIND_SCHEMAS = {
  brief: z
    .object({
      date: short(60).optional(),
      headline: short(200).optional(),
      items: z.array(BriefItem).max(50),
    })
    .describe('The daily brief: a dated headline plus a short list of priorities. Usually one per user, slug "today".'),
  list: z.object({ items: z.array(ListItem).max(500) }).describe('Tasks, reminders or any ordered list. Items can be ticked done.'),
  links: z.object({ items: z.array(LinkItem).max(500) }).describe('Bookmarks: dashboards, docs, folders.'),
  metrics: z
    .object({ asOf: short(60).optional(), items: z.array(MetricItem).max(24) })
    .describe('Key numbers shown as tiles. Optional progress bars.'),
  timeline: z.object({ entries: z.array(TimelineEntry).max(500) }).describe('Dated log, newest first: work history, journal.'),
  table: z
    .object({ columns: z.array(TableColumn).min(1).max(12), rows: z.array(TableRow).max(1000) })
    .describe('Rows and columns: bills, payments, inventories.'),
  markdown: z
    .object({ body: z.string().max(50000) })
    .describe('A long standalone document in Markdown (a spec, a plan). For notes, use add_note: notes live on the Notes board.'),
  notes: z
    .object({ items: z.array(NoteItem).max(1000) })
    .describe('The Notes board (slug "notes"): every note the user or an agent writes. Use add_note / update_note instead of writing this directly.'),
  chart: ChartData.describe('A chart: bars, a line/area over time, or parts of a whole. Patch a series by id to update its values.'),
  tracker: TrackerData.describe('A kanban tracker: items moving through stages (job hunt, leads, content pipeline). Patch an item\'s stage to move it.'),
  habits: z.object({ items: z.array(Habit).max(30) }).describe('Habits with daily check-offs, streaks and a calendar grid. Add a YYYY-MM-DD to days to tick a day.'),
  goals: z.object({ items: z.array(Goal).max(30) }).describe('Goals with a target, current progress and an optional deadline.'),
  countdown: z.object({ items: z.array(CountdownItem).max(50) }).describe('Countdowns to dates: trips, launches, due dates. Shows days left.'),
} as const;

/** Widget kinds a dashboard can hold (no briefs, no nested dashboards). */
export const WIDGET_KINDS = ['metrics', 'chart', 'list', 'table', 'links', 'timeline', 'markdown', 'note', 'goals', 'countdown', 'tracker', 'habits'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** Longest text a dashboard may hold inline; anything longer belongs in Notes. */
export const WIDGET_TEXT_MAX = 600;

const WIDGET_DATA = {
  ...KIND_SCHEMAS,
  markdown: z
    .object({
      body: z
        .string()
        .max(WIDGET_TEXT_MAX, `Dashboard text is capped at ${WIDGET_TEXT_MAX} characters. Put longer text in Notes with add_note, then link it here with a "note" widget.`),
    })
    .describe(`A short caption (max ${WIDGET_TEXT_MAX} chars). Longer text goes in Notes, linked with a "note" widget.`),
  note: z
    .object({ note: id.describe('The note id from add_note / find_notes.') })
    .describe('A link card to a note on the Notes board: shows its title, first line and last edit; tapping opens it.'),
} as const;

export const WIDGET_SIZES = ['s', 'm', 'l', 'xl'] as const;
export const WIDGET_VIEWS = ['auto', 'ring', 'bars', 'heatmap', 'dots', 'compact'] as const;
export const DASHBOARD_LOOKS = ['cards', 'compact', 'focus'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export type WidgetView = (typeof WIDGET_VIEWS)[number];
export type DashboardLook = (typeof DASHBOARD_LOOKS)[number];

const widget = <K extends WidgetKind>(kind: K) =>
  z.object({
    id,
    title: short(60).min(1),
    kind: z.literal(kind),
    width: z.enum(['full', 'half']).optional().describe('Legacy; prefer size. half = two widgets side by side on wide screens (stacked on phones). Default full.'),
    size: z.enum(WIDGET_SIZES).optional().describe('How much room the widget takes on the grid: s = a small tile, m = half width, l = three quarters, xl = full width. Overrides width. Default depends on the kind.'),
    view: z.enum(WIDGET_VIEWS).optional().describe('How the widget draws itself. auto = the best default. ring = progress rings (goals, habits). bars = bars (goals, tracker). heatmap = a calendar heatmap (habits). dots = a row of dots (habits). compact = a dense list.'),
    hidden: z.boolean().optional().describe('Hide the widget from the dashboard without deleting it. The owner can show it again in Customize.'),
    section: short(40).optional().describe('Group widgets under a heading. Consecutive widgets with the same section share one heading.'),
    source: short(60).optional().describe('Where this came from, e.g. "Gmail", "Google Sheets", "manual".'),
    as_of: z.iso.datetime({ offset: true }).optional().describe('When the data was last checked at the source (ISO 8601). Not when it was edited.'),
    stale_after_hours: z.number().int().min(1).max(8760).optional().describe('Show a Stale warning once as_of is older than this.'),
    data: WIDGET_DATA[kind],
  });

export const DashboardData = z
  .object({
    summary: short(200).optional().describe('One line under the title: what this dashboard is for.'),
    look: z.enum(DASHBOARD_LOOKS).optional().describe('Overall style. cards = default. compact = tighter spacing and smaller cards. focus = calmer: quiet tints, bigger numbers.'),
    widgets: z
      .array(z.discriminatedUnion('kind', [widget('metrics'), widget('chart'), widget('list'), widget('table'), widget('links'), widget('timeline'), widget('markdown'), widget('note'), widget('goals'), widget('countdown'), widget('tracker'), widget('habits')]))
      .min(1, 'add at least one widget')
      .max(24, 'at most 24 widgets: split into two dashboards'),
  })
  .describe(
    'A dashboard: ONE board made of several widgets (metrics tiles, charts, tables, lists, links, timelines) laid out together. Never paste long text into a dashboard: write it with add_note and add a "note" widget that links to it. Use this whenever the user asks for a dashboard or an overview of a project. Each widget has id, title, kind, data in that kind\'s format, and optional layout fields: size (s|m|l|xl), view (auto|ring|bars|heatmap|dots|compact), hidden, section. The array order is the display order. To restyle or rearrange without touching data, call set_layout. Patch a widget by id.',
  );

export const ALL_KIND_SCHEMAS = { ...KIND_SCHEMAS, dashboard: DashboardData } as const;

export type SlateKind = keyof typeof ALL_KIND_SCHEMAS;
export const SLATE_KINDS = Object.keys(ALL_KIND_SCHEMAS) as SlateKind[];
export const SlateKindEnum = z.enum(SLATE_KINDS as [SlateKind, ...SlateKind[]]);

/** Which array holds patchable items for each kind (markdown has none). */
export const COLLECTION_KEY: Record<SlateKind, 'items' | 'entries' | 'rows' | 'series' | 'widgets' | null> = {
  brief: 'items',
  notes: 'items',
  list: 'items',
  links: 'items',
  metrics: 'items',
  timeline: 'entries',
  table: 'rows',
  markdown: null,
  chart: 'series',
  dashboard: 'widgets',
  tracker: 'items',
  habits: 'items',
  goals: 'items',
  countdown: 'items',
};

export type KindData = { [K in SlateKind]: z.infer<(typeof ALL_KIND_SCHEMAS)[K]> };
export type BriefData = KindData['brief'];
export type ListData = KindData['list'];
export type LinksData = KindData['links'];
export type MetricsData = KindData['metrics'];
export type TimelineData = KindData['timeline'];
export type TableData = KindData['table'];
export type MarkdownData = KindData['markdown'];
export type ChartData = KindData['chart'];
export type DashboardDataT = KindData['dashboard'];
export type NotesData = KindData['notes'];
export type Note = NotesData['items'][number];
export type TrackerDataT = KindData['tracker'];
export type HabitsData = KindData['habits'];
export type GoalsData = KindData['goals'];
export type CountdownData = KindData['countdown'];
export type FileRefT = z.infer<typeof FileRef>;

/** The one Notes board. */
export const NOTES_SLUG = 'notes';

export type Slate = {
  id: string;
  slug: string;
  title: string;
  kind: SlateKind;
  icon: string | null;
  category: string | null;
  data: Record<string, unknown>;
  position: number;
  pinned: boolean;
  hidden: boolean;
  archived_at: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  share_token?: string | null;
};

export class ValidationError extends Error {
  constructor(message: string, readonly issues?: unknown) {
    super(message);
  }
}

/** Validate data for a kind; returns the parsed (cleaned) data or throws ValidationError. */
export function validateData<K extends SlateKind>(kind: K, data: unknown): KindData[K] {
  const schema = ALL_KIND_SCHEMAS[kind];
  if (!schema) throw new ValidationError(`Unknown kind "${kind}"`);
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new ValidationError(`Invalid data for kind "${kind}": ${z.prettifyError(res.error)}`, res.error.issues);
  }
  const collection = COLLECTION_KEY[kind];
  if (collection) {
    const items = (res.data as Record<string, { id: string }[]>)[collection];
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) throw new ValidationError(`Duplicate ${collection} id "${it.id}"`);
      seen.add(it.id);
    }
  }
  return res.data as KindData[K];
}

/**
 * Upsert and remove collection items by id. Upserted items are shallow-merged into
 * existing ones (so an agent can send {id, done: true}); new ids are appended, or
 * prepended when `prepend` is set (useful for timelines, newest first).
 */
export function patchCollection(
  kind: SlateKind,
  data: Record<string, unknown>,
  patch: { upsert?: Record<string, unknown>[]; remove?: string[]; prepend?: boolean },
): Record<string, unknown> {
  const key = COLLECTION_KEY[kind];
  if (!key) throw new ValidationError(`Kind "${kind}" has no items to patch; use update_slate with full data instead.`);
  const current = Array.isArray(data[key]) ? (data[key] as Record<string, unknown>[]) : [];
  const remove = new Set(patch.remove ?? []);
  let next = current.filter((it) => !remove.has(String(it.id)));
  const added: Record<string, unknown>[] = [];
  for (const item of patch.upsert ?? []) {
    if (typeof item?.id !== 'string' || !item.id) throw new ValidationError('Every upserted item needs a string "id".');
    const idx = next.findIndex((it) => it.id === item.id);
    if (idx >= 0) {
      const merged = { ...next[idx], ...item };
      if (kind === 'table' && item.cells && next[idx].cells) {
        merged.cells = { ...(next[idx].cells as object), ...(item.cells as object) };
      }
      next = next.with(idx, merged);
    } else {
      added.push(item);
    }
  }
  next = patch.prepend ? [...added, ...next] : [...next, ...added];
  return { ...data, [key]: next };
}

/** JSON-schema description of every kind, for agents (describe_kinds tool). */
export function describeKinds() {
  return Object.fromEntries(
    SLATE_KINDS.map((k) => [
      k,
      {
        description: ALL_KIND_SCHEMAS[k].description,
        collection: COLLECTION_KEY[k],
        schema: z.toJSONSchema(ALL_KIND_SCHEMAS[k], { io: 'input' }),
      },
    ]),
  );
}

export const EXAMPLES: Record<SlateKind, unknown> = {
  brief: { date: 'Tue 3 Nov', headline: 'Ship Slates v2', items: [{ id: 'a', text: 'Review PR', tone: 'warn' }] },
  list: { items: [{ id: 'milk', text: 'Buy milk', meta: 'today' }] },
  links: { items: [{ id: 'gh', title: 'GitHub', url: 'https://github.com' }] },
  metrics: { items: [{ id: 'runway', label: 'Runway', value: '7 mo', progress: 58 }] },
  timeline: { entries: [{ id: '2026-11-03', date: '3 Nov', items: ['Launched v2'] }] },
  table: { columns: [{ key: 'item', label: 'Item' }, { key: 'amt', label: 'Amount', align: 'end' }], rows: [{ id: 'r1', cells: { item: 'Rent', amt: '25,000' } }] },
  markdown: { body: '## Plan\n- one\n- two' },
  notes: { items: [{ id: 'launch-plan', title: 'Launch plan', body: '## Goals\n- 100 sign-ups', tags: ['launchreel'] }] },
  chart: {
    type: 'bar',
    labels: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
    series: [{ id: 'spend', name: 'Spend', values: [820, 1040, 760, 1180, 1048, 640] }],
    prefix: '₹',
    highlight: 5,
    caption: 'November so far',
  },
  tracker: {
    stages: [{ id: 'applied', name: 'Applied' }, { id: 'interview', name: 'Interview' }, { id: 'offer', name: 'Offer' }],
    items: [{ id: 'acme', title: 'Acme · Product designer', stage: 'interview', due: '2026-11-12' }],
  },
  habits: { items: [{ id: 'gym', name: 'Gym', days: ['2026-11-02', '2026-11-03'] }] },
  goals: { items: [{ id: 'save', title: 'Emergency fund', current: 120000, target: 300000, prefix: '₹', deadline: '2027-03-31' }] },
  countdown: { items: [{ id: 'goa', title: 'Goa trip', date: '2026-12-20' }] },
  dashboard: {
    summary: 'Launch progress at a glance',
    widgets: [
      { id: 'kpis', title: 'This week', kind: 'metrics', data: { items: [{ id: 'leads', label: 'Leads', value: '52', trend: [12, 18, 25, 31, 44, 52] }, { id: 'demos', label: 'Demos booked', value: '7' }] } },
      { id: 'signups', title: 'Sign-ups', kind: 'chart', width: 'half', data: { type: 'bar', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [{ id: 's', name: 'Sign-ups', values: [3, 5, 2, 8, 6] }] } },
      { id: 'next', title: 'Next steps', kind: 'list', width: 'half', data: { items: [{ id: 'a', text: 'Record the demo video' }, { id: 'b', text: 'Email the first 20 leads' }] } },
      { id: 'plan', title: 'Launch plan', kind: 'note', width: 'half', data: { note: 'launch-plan' } },
      { id: 'leads', title: 'Top leads', kind: 'table', data: { columns: [{ key: 'name', label: 'Lead' }, { key: 'stage', label: 'Stage' }], rows: [{ id: 'r1', cells: { name: 'Acme', stage: 'Demo' } }] } },
    ],
  },
};
