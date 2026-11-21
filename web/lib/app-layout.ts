import { z } from 'zod';
import { PALETTE_IDS } from '@/lib/palettes';
import { HEX } from '@/lib/custom-palette';

/**
 * The app-wide layout: one small JSON document per person. Everything is optional, and anything
 * missing or invalid falls back to the defaults, so a bad write can never break the app.
 */
export const ROUTE_TABS = {
  home: { href: '/home', label: 'Home', match: '^/home(/|$)' },
  boards: { href: '/boards', label: 'Boards', match: '^/(boards|s)(/|$)' },
  notes: { href: '/notes', label: 'Notes', match: '^/notes(/|$)' },
  reminders: { href: '/reminders', label: 'Reminders', match: '^/reminders(/|$)' },
  inbox: { href: '/inbox', label: 'Inbox', match: '^/inbox(/|$)' },
  ask: { href: '/ask', label: 'Ask', match: '^/ask(/|$)' },
  agents: { href: '/agents', label: 'Agents', match: '^/agents' },
  activity: { href: '/activity', label: 'Activity', match: '^/activity' },
  automations: { href: '/settings/automations', label: 'Automations', match: '^/settings/automations' },
  settings: { href: '/settings', label: 'Settings', match: '^/settings(?!/automations)' },
  profile: { href: '/profile', label: 'Profile', match: '^/profile' },
  admin: { href: '/admin', label: 'Admin', match: '^/admin' },
} as const;
export type RouteTabId = keyof typeof ROUTE_TABS;
export const ROUTE_TAB_IDS = Object.keys(ROUTE_TABS) as RouteTabId[];
/** Places only admins see; for everyone else they are skipped quietly. */
export const ADMIN_ONLY: readonly RouteTabId[] = ['admin'];
export const placesFor = (admin: boolean) => ROUTE_TAB_IDS.filter((id) => admin || !ADMIN_ONLY.includes(id));

export const TabSchema = z.union([
  z.object({ type: z.literal('route'), id: z.enum(ROUTE_TAB_IDS as [RouteTabId, ...RouteTabId[]]) }),
  z.object({ type: z.literal('board'), slug: z.string().min(1).max(80) }),
]);
export type Tab = z.infer<typeof TabSchema>;

/** Your shortcuts in the Apps sheet: any board, or a single note. */
export const PinSchema = z.union([
  z.object({ type: z.literal('board'), slug: z.string().min(1).max(80) }),
  z.object({ type: z.literal('note'), id: z.string().min(1).max(64) }),
]);
export type Pin = z.infer<typeof PinSchema>;
export const MAX_PINS = 12;
export const pinKey = (p: Pin) => (p.type === 'board' ? `b:${p.slug}` : `n:${p.id}`);

/** Three fixed tabs; the fourth slot is the Apps launcher that opens your shortcuts. */
export const MAX_TABS = 3;
export const MAX_SHORTCUTS = 12;
export const DEFAULT_TABS: Tab[] = [
  { type: 'route', id: 'home' },
  { type: 'route', id: 'boards' },
  { type: 'route', id: 'notes' },
];
export const DEFAULT_SHORTCUTS: Tab[] = [
  { type: 'route', id: 'reminders' },
  { type: 'route', id: 'inbox' },
  { type: 'route', id: 'ask' },
  { type: 'route', id: 'agents' },
  { type: 'route', id: 'activity' },
  { type: 'route', id: 'automations' },
];

/** Quick buttons on the brief card (up to 3). */
export const QUICK = {
  brief: { label: 'Brief', href: null }, // the brief board, or Agents until a brief exists
  remind: { label: 'Remind', href: '/reminders' },
  inbox: { label: 'Inbox', href: '/inbox' },
  ask: { label: 'Ask', href: '/ask' },
  notes: { label: 'Notes', href: '/notes' },
  boards: { label: 'Boards', href: '/boards' },
  agents: { label: 'Agents', href: '/agents' },
  activity: { label: 'Activity', href: '/activity' },
} as const;
export type QuickId = keyof typeof QUICK;
export const QUICK_IDS = Object.keys(QUICK) as QuickId[];
export const DEFAULT_QUICK: QuickId[] = ['brief', 'remind', 'inbox'];

/** Blocks on the home screen, top to bottom. A block you remove is hidden; Reset brings the default back. */
export const HomeBlockSchema = z.union([
  z.object({ type: z.literal('brief') }),
  z.object({ type: z.literal('since') }),
  z.object({ type: z.literal('board'), slug: z.string().min(1).max(80) }),
  z.object({ type: z.literal('widget'), slug: z.string().min(1).max(80), widget: z.string().min(1).max(80) }),
]);
export type HomeBlock = z.infer<typeof HomeBlockSchema>;
/** Home stays small: the brief, since-you-looked and up to three pinned boards or widgets. */
export const MAX_HOME_BLOCKS = 5;
/** Older layouts may hold more; they still load, and are trimmed to MAX_HOME_BLOCKS. */
const STORED_HOME_BLOCKS = 12;
export const DEFAULT_HOME_BLOCKS: HomeBlock[] = [{ type: 'brief' }, { type: 'since' }];

export const HomeSchema = z.object({
  blocks: z.array(HomeBlockSchema).max(STORED_HOME_BLOCKS).optional(),
  quick: z.array(z.enum(QUICK_IDS as [QuickId, ...QuickId[]])).min(1).max(3).optional(),
  /** Use this dashboard as the whole home screen (below the greeting). */
  dashboard: z.string().min(1).max(80).nullable().optional(),
});
export type HomeLayout = z.infer<typeof HomeSchema>;

export const blockKey = (b: HomeBlock) => (b.type === 'board' ? `board:${b.slug}` : b.type === 'widget' ? `widget:${b.slug}:${b.widget}` : b.type);

export const AppLayoutSchema = z.object({
  v: z.literal(1).default(1),
  // Up to 4 are accepted so layouts saved before the launcher still load; parseLayout trims to 3.
  tabs: z.array(TabSchema).min(2).max(4).optional(),
  shortcuts: z.array(TabSchema).max(MAX_SHORTCUTS).optional(),
  pins: z.array(PinSchema).max(MAX_PINS).optional(),
  home: HomeSchema.optional(),
  palette: z.enum(PALETTE_IDS).optional(),
  /** A custom palette from one accent colour (#rrggbb). When set it wins over `palette`. */
  accent: z.string().regex(HEX).optional(),
});
export type AppLayout = z.infer<typeof AppLayoutSchema>;

const tabKey = (t: Tab) => (t.type === 'route' ? `r:${t.id}` : `b:${t.slug}`);
const dedupe = (list: Tab[]) => {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(tabKey(t)) ? false : (seen.add(tabKey(t)), true)));
};

/**
 * Parse whatever is stored; never throws. Drops duplicates. A layout saved with a 4th tab (before
 * the launcher existed) keeps its first three tabs, and the 4th becomes the first shortcut.
 */
export function parseLayout(raw: unknown): AppLayout {
  const r = AppLayoutSchema.safeParse(raw ?? {});
  const layout: AppLayout = r.success ? r.data : { v: 1 };
  let tabs = layout.tabs ? dedupe(layout.tabs) : undefined;
  let shortcuts = layout.shortcuts ? dedupe(layout.shortcuts) : undefined;
  if (tabs && tabs.length > MAX_TABS) {
    const moved = tabs.slice(MAX_TABS);
    tabs = tabs.slice(0, MAX_TABS);
    shortcuts = dedupe([...moved, ...(shortcuts ?? DEFAULT_SHORTCUTS)]).slice(0, MAX_SHORTCUTS);
  }
  const out: AppLayout = { v: 1 };
  if (tabs && tabs.length >= 2) out.tabs = tabs;
  if (shortcuts) out.shortcuts = shortcuts;
  if (layout.pins) {
    const seen = new Set<string>();
    out.pins = layout.pins.filter((p) => (seen.has(pinKey(p)) ? false : (seen.add(pinKey(p)), true)));
  }
  if (layout.accent) out.accent = layout.accent.toLowerCase();
  else if (layout.palette && layout.palette !== 'lime') out.palette = layout.palette;
  if (layout.home) {
    const seen = new Set<string>();
    const blocks = layout.home.blocks?.filter((b) => (seen.has(blockKey(b)) ? false : (seen.add(blockKey(b)), true))).slice(0, MAX_HOME_BLOCKS);
    out.home = { ...layout.home, ...(blocks ? { blocks } : {}) };
  }
  return out;
}

/** What the bar and launcher render: fully resolved on the server so the client needs no lookups. */
export type ResolvedTab = { key: string; href: string; label: string; title: string; match: string; icon: string; board?: { icon: string | null; kind: string } };
type BoardInfo = { slug: string; title: string; icon: string | null; kind: string };

type ResolveOpts = { admin?: boolean };

const routeTab = (id: RouteTabId): ResolvedTab => {
  const r = ROUTE_TABS[id];
  return { key: id, href: r.href, label: r.label, title: r.label, match: r.match, icon: id };
};

function resolveList(list: Tab[], boards: BoardInfo[], opts: ResolveOpts = {}): ResolvedTab[] {
  const out: ResolvedTab[] = [];
  for (const t of list) {
    if (t.type === 'route') {
      if (ADMIN_ONLY.includes(t.id) && !opts.admin) continue;
      out.push(routeTab(t.id));
    } else {
      const b = boards.find((x) => x.slug === t.slug);
      if (!b) continue; // board deleted: skip quietly
      out.push({ key: `b-${b.slug}`, href: `/s/${b.slug}`, label: b.title.length > 10 ? `${b.title.slice(0, 9)}…` : b.title, title: b.title, match: `^/s/${b.slug}(/|$)`, icon: 'board', board: { icon: b.icon, kind: b.kind } });
    }
  }
  return out;
}

export function resolveTabs(layout: AppLayout, boards: BoardInfo[], opts: ResolveOpts = {}): ResolvedTab[] {
  const tabs = resolveList(layout.tabs ?? DEFAULT_TABS, boards, opts);
  return tabs.length >= 2 ? tabs : resolveList(DEFAULT_TABS, boards, opts);
}

/**
 * Shortcuts shown in the launcher; anything already a tab is left out. Settings (and Admin, for admins)
 * are always one tap away, even in layouts saved before they existed.
 */
export function resolveShortcuts(layout: AppLayout, boards: BoardInfo[], opts: ResolveOpts = {}): ResolvedTab[] {
  const tabs = resolveTabs(layout, boards, opts);
  const list = resolveList(layout.shortcuts ?? DEFAULT_SHORTCUTS, boards, opts).filter((s) => !tabs.some((t) => t.href === s.href));
  for (const id of opts.admin ? (['settings', 'admin'] as const) : (['settings'] as const)) {
    if (![...tabs, ...list].some((t) => t.key === id)) list.push(routeTab(id));
  }
  return list;
}

/** The one tab that is "current". A pinned board wins over the general Boards tab, so only one lights up. */
export function activeTabKey(path: string, tabs: ResolvedTab[]): string | null {
  const hit = (t: ResolvedTab) => new RegExp(t.match).test(path);
  return (tabs.find((t) => t.icon === 'board' && hit(t)) ?? tabs.find(hit))?.key ?? null;
}

export type ResolvedPin = { key: string; pin: Pin; href: string; title: string; icon: string | null; kind: string };

/**
 * The shortcuts under the dashed line in the Apps sheet. Until you choose some, they are the
 * boards you had as shortcuts before, or else your pinned boards. Deleted boards and notes drop out.
 */
export function resolvePins(layout: AppLayout, boards: (BoardInfo & { pinned?: boolean })[], notes: { id: string; title: string }[]): ResolvedPin[] {
  let pins: Pin[] | undefined = layout.pins;
  if (!pins) {
    const old = (layout.shortcuts ?? []).flatMap((t): Pin[] => (t.type === 'board' ? [{ type: 'board', slug: t.slug }] : []));
    pins = old.length ? old : boards.filter((b) => b.pinned).slice(0, 8).map((b) => ({ type: 'board' as const, slug: b.slug }));
  }
  return pins.flatMap((p): ResolvedPin[] => {
    if (p.type === 'board') {
      const b = boards.find((x) => x.slug === p.slug);
      return b ? [{ key: pinKey(p), pin: p, href: `/s/${b.slug}`, title: b.title, icon: b.icon, kind: b.kind }] : [];
    }
    const n = notes.find((x) => x.id === p.id);
    return n ? [{ key: pinKey(p), pin: p, href: `/notes/${encodeURIComponent(n.id)}`, title: n.title, icon: null, kind: 'notes' }] : [];
  });
}
