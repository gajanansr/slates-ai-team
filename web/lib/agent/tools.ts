import { z } from 'zod';
import { applyLayout } from '@/lib/layout';
import { PALETTE_IDS, DEFAULT_PALETTE } from '@/lib/palettes';
import { AppLayoutSchema, DEFAULT_HOME_BLOCKS, DEFAULT_QUICK, DEFAULT_SHORTCUTS, DEFAULT_TABS, HomeSchema, MAX_HOME_BLOCKS, MAX_SHORTCUTS, MAX_TABS, MAX_PINS, PinSchema, QUICK_IDS, ROUTE_TAB_IDS, TabSchema, parseLayout } from '@/lib/app-layout';
import { DASHBOARD_LOOKS, WIDGET_SIZES, WIDGET_VIEWS } from '@/lib/kinds';
import { COLLECTION_KEY, describeKinds, EXAMPLES, SLATE_KINDS, SlateKindEnum, WIDGET_KINDS, type Slate } from '@/lib/kinds';

// Kind lists in tool text come from the registry, so new kinds are never missing (BUG-17).
const KIND_LIST = SLATE_KINDS.join(', ');
const COLLECTIONS = (() => {
  const by = new Map<string, string[]>();
  for (const k of SLATE_KINDS) {
    const c = COLLECTION_KEY[k];
    if (c && c !== 'series') by.set(c, [...(by.get(c) ?? []), k]);
  }
  return [...by.entries()].map(([c, ks]) => `${c} for ${ks.join('/')}`).join(', ');
})();
import { slates, SlatesError, type Caller } from '@/lib/slates';
import { TEMPLATES } from '@/lib/templates';
import { agentNotify } from '@/lib/agent/notify';
import { reminders } from '@/lib/reminders';
import { ICON_NAMES } from '@/lib/icons';
import { SITE_URL } from '@/lib/env';
import { notes, noteUrl, summaryOf } from '@/lib/notes';
import { history } from '@/lib/history';
import { inbox } from '@/lib/inbox';
import { about } from '@/lib/about';
import { desk, deskForAgent, whoIs } from '@/lib/desk';
import { searchAll } from '@/lib/search';
import { getBoard, notesOf } from '@/lib/notes';
import { DAILY_BUILDS } from '@/lib/studio/limits';

/**
 * The agent tool set. One definition serves both the MCP server (/mcp) and the
 * REST API (/api/v1/tools/:name and the resource routes).
 */
export type Tool = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly: boolean;
  /** Per-user cap enforced by the tool itself (others are enforced in the database, e.g. notify). */
  limit?: { max: number; per: 'hour' | 'day' };
  run: (caller: Caller, args: any) => Promise<unknown>;
};

const slug = z.string().describe('Slate slug, e.g. "today" or "groceries". From list_slates.');
const item = z.record(z.string(), z.unknown()).describe('An item object for the slate kind; must include "id".');

/** Canonical browser URL for a board (BUG-11). */
export const boardUrl = (slug: string) => `${SITE_URL}/s/${slug}`;
function withUrl<T>(s: T): T {
  if (!s || typeof s !== 'object' || !('slug' in s)) return s;
  return { ...s, url: boardUrl(String((s as unknown as { slug: string }).slug)) };
}

/** Compact view for list output so agents do not pull every row of every slate. */
function summary(s: Slate) {
  const counts = Object.entries(s.data)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${(v as unknown[]).length} ${k}`)
    .join(', ');
  return {
    slug: s.slug,
    title: s.title,
    kind: s.kind,
    category: s.category ?? undefined,
    pinned: s.pinned,
    hidden: s.hidden,
    archived: Boolean(s.archived_at),
    version: s.version,
    size: counts || undefined,
    updated_at: s.updated_at,
    updated_by: s.updated_by_name ?? (s.updated_by ? 'agent' : 'owner'),
    url: boardUrl(s.slug),
  };
}


/** Automations through the agent's own token (scope checks live in the database function). */
async function automations<T>(c: Caller, op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.client.rpc('agent_automations_exec', { p_op: op, p_args: args, p_token: c.token });
  if (error) {
    const status = ({ P0401: 401, P0403: 403, P0404: 404, P0409: 409 } as Record<string, number>)[error.code ?? ''] ?? 422;
    throw new SlatesError(error.message, status, status === 404 ? 'not_found' : 'invalid');
  }
  return data as T;
}
const AutomationKindEnum = z.enum(['brief', 'recap', 'inbox', 'rss']);
const automationView = (a: any) => ({
  id: a.id,
  kind: a.kind,
  title: a.title,
  every: a.every,
  at_hour: a.at_hour,
  at_weekday: a.at_weekday,
  enabled: a.enabled,
  config: a.config,
  next_run_at: a.next_run_at,
  last_run_at: a.last_run_at,
  last_status: a.last_status,
  last_error: a.last_error,
});

export const TOOLS: Tool[] = [
  {
    name: 'get_about_me',
    title: 'About the user',
    description:
      'Read what is known about the user: who they are, their work and projects, people, preferences. This memory is shared by every agent the user connects. Call it FIRST in every conversation, before anything else.',
    input: z.object({}),
    readOnly: true,
    run: async (c) => {
      const n = await about.get(c);
      return n ? { known: true, body: n.body, updated_at: n.updated_at, updated_by: n.by } : { known: false, body: '', hint: 'Nothing is known yet. Offer a two-minute interview (work, projects, people, what they want to track), then save what you learn with remember.' };
    },
  },
  {
    name: 'remember',
    title: 'Remember about the user',
    description:
      'Save one durable fact about the user to the shared memory, so every other agent knows it too: a preference, a project, a person, a routine. One short sentence per call. Not for tasks, events or anything that expires; those go on boards or reminders. Never store passwords, card numbers or government ids.',
    input: z.object({
      fact: z.string().min(3).max(300),
      section: z.string().max(40).optional().describe('Heading to file it under, e.g. "Me", "Work and projects", "People", "Preferences".'),
    }),
    readOnly: false,
    run: (c, a) => about.remember(c, a.fact, a.section),
  },
  {
    name: 'check_desk',
    title: 'Check the desk',
    description:
      'Everything waiting for you: the user\'s open instructions (a task tagged @your-name is yours; untagged ones are for any agent; tasks tagged for another agent are not shown) and work other agents handed off (do them, then resolve_desk_item), answers to questions agents asked, decisions on approvals, and how the last few sessions ended (any agent). Call it at the start of every conversation, right after get_about_me.',
    input: z.object({}),
    readOnly: true,
    run: async (c) => deskForAgent(await desk.list(c), await whoIs(c)),
  },
  {
    name: 'ask_user',
    title: 'Ask the user',
    description:
      'Leave a question for the user when you need a decision and they are not in the conversation (or it can wait). It appears under "Needs you" in Today; they answer with one tap or a short reply, and the answer shows up in check_desk. Give up to 4 short options when the choice is simple.',
    input: z.object({
      question: z.string().min(3).max(300),
      context: z.string().max(400).optional().describe('One or two sentences on why you ask.'),
      options: z.array(z.string().min(1).max(60)).max(4).optional(),
    }),
    readOnly: false,
    run: async (c, a) => {
      const item = await desk.add(c, 'question', { text: a.question, context: a.context, options: a.options });
      await agentNotify(c, 'agent', { title: `${item.from} has a question`, body: a.question, url: '/home', tag: 'desk' }).catch(() => undefined);
      return { id: item.id, status: 'waiting_on_user' };
    },
  },
  {
    name: 'end_session',
    title: 'End the session',
    description:
      'Before a conversation ends, leave two lines for whichever agent comes next (it may be a different assistant): what you did, and what is still open. They show up in check_desk under last_sessions. Call it once, at the end, whenever you changed something.',
    input: z.object({ did: z.string().min(3).max(400), still_open: z.string().max(400).optional() }),
    readOnly: false,
    run: async (c, a) => ({ id: (await desk.add(c, 'session', { text: a.did, context: a.still_open })).id, status: 'noted' }),
  },
  {
    name: 'hand_off',
    title: 'Hand off to another agent',
    description:
      'Leave a task for another of the user\'s agents, by name ("Gemini", "Claude"), or for whichever connects next. Use it for work you cannot do yourself (no web access, no code, a tool the other has). It appears in that agent\'s check_desk under handoffs; they resolve_desk_item with a reply when done.',
    input: z.object({
      task: z.string().min(3).max(400),
      to: z.string().max(60).optional().describe('Agent name as the user named it. Leave out for any agent.'),
      context: z.string().max(400).optional().describe('What they need to know: where the result goes, links, constraints.'),
    }),
    readOnly: false,
    run: async (c, a) => ({ id: (await desk.add(c, 'handoff', { text: a.task, to: a.to, context: a.context })).id, status: 'handed_off', to: a.to ?? 'any agent' }),
  },
  {
    name: 'search',
    title: 'Search everything',
    description: 'Search across every board (titles and the items inside), every note and open reminders in one call. Use it before creating something, to find where a thing already lives.',
    input: z.object({ query: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).optional() }),
    readOnly: true,
    run: async (c, a) => {
      const [all, board, open] = await Promise.all([slates.list(c), getBoard(c).catch(() => null), reminders.list(c).catch(() => [])]);
      return searchAll(a.query, all, notesOf(board), open, a.limit ?? 20).map((h) => ({ kind: h.kind, title: h.title, where: h.sub, url: `${SITE_URL}${h.href}` }));
    },
  },
  {
    name: 'list_playbooks',
    title: 'List playbooks',
    description:
      'Playbooks are the user\'s own instructions for recurring jobs (weekly review, how to write the brief, how to log expenses). They are notes tagged "playbook". Check this list before a recurring or multi-step job and follow the matching one (get_note to read it). Save a new one with add_note and tags ["playbook"] when the user explains how they want something done.',
    input: z.object({}),
    readOnly: true,
    run: async (c) => (await notes.find(c, { tag: 'playbook', limit: 50 })).map((n: any) => ({ id: n.id, title: n.title, snippet: n.snippet, updated_at: n.updated_at })),
  },
  {
    name: 'resolve_desk_item',
    title: 'Resolve a desk item',
    description:
      'After you carry out one of the user\'s instructions, mark it handled with a short reply saying what you did. Also clears an answer or decision once you have read and acted on it.',
    input: z.object({ id: z.string().max(64), reply: z.string().max(300).optional() }),
    readOnly: false,
    run: (c, a) => desk.resolve(c, a.id, a.reply),
  },
  {
    name: 'list_slates',
    title: 'List slates',
    description:
      "List the user's slates (dashboard sections) in display order, with kind, version and item counts. Call this first to see what exists.",
    input: z.object({ include_archived: z.boolean().optional() }),
    readOnly: true,
    run: async (c, a) => (await slates.list(c, a)).map(summary),
  },
  {
    name: 'get_slate',
    title: 'Get slate',
    description: 'Get one slate with its full data and current version.',
    input: z.object({ slug }),
    readOnly: true,
    run: async (c, a) => withUrl(await slates.get(c, a.slug)),
  },
  {
    name: 'describe_kinds',
    title: 'Describe slate kinds',
    description:
      `Return the JSON schema and an example for every slate kind (${KIND_LIST}) and every dashboard widget kind (${WIDGET_KINDS.join(', ')}). Read this before creating a slate or writing data.`,
    input: z.object({}),
    readOnly: true,
    run: async () => {
      const kinds = describeKinds();
      return Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { ...v, example: EXAMPLES[k as keyof typeof EXAMPLES] }]));
    },
  },
  {
    name: 'create_slate',
    title: 'Create slate',
    description:
      'Create a new slate (a board). data must match the kind schema from describe_kinds. When the user asks for a DASHBOARD or an overview, create ONE slate of kind "dashboard" whose widgets combine metrics, charts, tables, lists and links; do not scatter it across several boards. Use separate slates only for things that stand alone. Never create a board for notes: use add_note. Slug is derived from the title when omitted. Set category to group related boards.',
    input: z.object({
      title: z.string().min(1).max(120),
      kind: SlateKindEnum,
      data: z.record(z.string(), z.unknown()),
      slug: slug.optional(),
      icon: z.enum(ICON_NAMES).optional().describe('Optional icon name from the allowed list (line icons). Never use emoji. Leave it out to use the kind\'s default icon.'),
      category: z.string().max(40).optional().describe('Group on the Boards page, e.g. "Money", "Work", "Health". Reuse existing categories from list_slates.'),
      pinned: z.boolean().optional().describe('Pinned slates show on the home screen first.'),
      note: z.string().max(300).optional().describe('Shown in the activity feed.'),
    }),
    readOnly: false,
    run: async (c, a) => withUrl(await slates.create(c, a)),
  },
  {
    name: 'list_templates',
    title: 'List board templates',
    description: 'Ready-made starter boards (budget, trip planner, job hunt, habits, goals, countdowns, launch dashboard...). Each has an id, what it is for, and a prompt describing how to keep it filled.',
    input: z.object({}),
    readOnly: true,
    run: async () => TEMPLATES.map(({ id, title, blurb, kind, category, prompt }) => ({ id, title, blurb, kind, category: category ?? null, prompt })),
  },
  {
    name: 'create_from_template',
    title: 'Create a board from a template',
    description: 'Create a new board from a template id (see list_templates), optionally renamed. Then fill it in with patch_items or update_slate, following the template prompt.',
    input: z.object({
      template: z.string().min(1).max(40),
      title: z.string().min(1).max(120).optional(),
      category: z.string().max(40).optional(),
    }),
    readOnly: false,
    run: async (c, a) => {
      const t = TEMPLATES.find((x) => x.id === a.template);
      if (!t) throw new SlatesError(`Unknown template "${a.template}". Call list_templates.`, 404, 'not_found');
      return withUrl(await slates.create(c, { title: a.title ?? t.title, kind: t.kind, data: t.data, icon: t.icon, category: a.category ?? t.category, note: `Created from the ${t.title} template` }));
    },
  },
  {
    name: 'build_agent',
    title: 'Build an agent',
    description:
      `Build the user a custom agent for a job ("manage my dairy business", "track my fitness goals", "run my side-project launch"): Slates designs it and creates its boards (a dashboard first) in a space named after it, starter notes, a playbook note, reminders and routines. Use it when the user asks you to manage, run or keep track of an area for them, or to make an agent. Takes 10-40 seconds. Returns the agent's page url and a short summary you can say out loud, plus up to 3 questions to personalise it (ask them, then update the boards). Safe to retry: the same agent name reuses its boards. Max ${DAILY_BUILDS} per user per day; needs a write token that is not limited to some boards.`,
    input: z.object({
      goal: z.string().min(3).max(300).describe('What the agent should do, in the user\'s words, e.g. "manage my dairy business".'),
      details: z.string().max(1500).optional().describe('Anything else you know that helps: size, numbers, how they work today, preferences.'),
    }),
    readOnly: false,
    limit: { max: DAILY_BUILDS, per: 'day' },
    run: async (c, a) => {
      // Loaded on use: the builder calls the text model, which imports this file.
      const { buildAgent, toolResult } = await import('@/lib/studio/service');
      return toolResult(await buildAgent(c, a));
    },
  },
  {
    name: 'list_automations',
    title: 'List automations',
    description:
      'Things Slates does on its own on a schedule: brief (morning brief), recap (weekly recap to Notes), inbox (auto-file the Inbox), rss (a feed into a links board). Shows schedule, on/off and the last run result.',
    input: z.object({}),
    readOnly: true,
    run: async (c) => (await automations<any[]>(c, 'list')).map(automationView),
  },
  {
    name: 'save_automation',
    title: 'Create or update an automation',
    description:
      'Create an automation (omit id) or change one (pass id). every: hourly | daily | weekly; at_hour 0-23 (daily/weekly), at_weekday 0=Sunday (weekly). rss config: {source: "hn"|"bbc"|"verge"|"techcrunch"|"ars"} or {url: any website or feed}, plus for Hacker News {hn_list: top|best|show|ask|new, min_score, max}. Any config may set notify: false. enabled: false pauses it. Needs a token with write access that is not limited to some boards.',
    input: z.object({
      id: z.string().uuid().optional(),
      kind: AutomationKindEnum,
      title: z.string().min(1).max(80),
      every: z.enum(['hourly', 'daily', 'weekly']),
      at_hour: z.number().int().min(0).max(23).nullable().optional(),
      at_weekday: z.number().int().min(0).max(6).nullable().optional(),
      enabled: z.boolean().optional(),
      config: z
        .object({
          source: z.string().max(20).optional(),
          url: z.string().max(2048).optional(),
          hn_list: z.enum(['top', 'best', 'show', 'ask', 'new']).optional(),
          min_score: z.number().int().min(0).max(5000).optional(),
          max: z.number().int().min(5).max(50).optional(),
          notify: z.boolean().optional(),
        })
        .optional(),
    }),
    readOnly: false,
    run: async (c, a) => {
      const { prepareAutomation, feedSlug } = await import('@/lib/automations');
      const prep = prepareAutomation(a.kind, a.config ?? {});
      if (!prep.ok) throw new SlatesError(prep.error, 422, 'invalid');
      const config = prep.config;
      // Editing a feed keeps writing to the same board.
      if (a.id && a.kind === 'rss' && !config.slug) {
        const old = (await automations<any[]>(c, 'list')).find((x) => x.id === a.id);
        if (old) config.slug = feedSlug(old.config ?? {});
      }
      const args: Record<string, unknown> = { kind: a.kind, title: a.title, every: a.every, config };
      if (a.id) args.id = a.id;
      if (a.at_hour !== undefined) args.at_hour = a.every === 'hourly' ? null : a.at_hour;
      if (a.at_weekday !== undefined) args.at_weekday = a.every === 'weekly' ? a.at_weekday : null;
      if (a.enabled !== undefined) args.enabled = a.enabled;
      return automationView(await automations(c, 'save', args));
    },
  },
  {
    name: 'run_automation',
    title: 'Run an automation now',
    description: 'Run an automation straight away (instead of waiting for its schedule) and return what happened.',
    input: z.object({ id: z.string().uuid() }),
    readOnly: false,
    run: async (c, a) => {
      await automations(c, 'run_now', { id: a.id });
      const secret = process.env.CRON_SECRET;
      if (!secret) return { status: 'queued', message: 'It runs within 15 minutes.' };
      const [{ runDueAutomations }, { supabaseAnon }] = await Promise.all([import('@/lib/automations-run'), import('@/lib/supabase/server')]);
      const mine = (await runDueAutomations(supabaseAnon(), secret)).find((r) => r.id === a.id);
      return mine ? { status: mine.status, ...(mine.error ? { error: mine.error } : {}), ...(mine.pushed ? { notified: mine.pushed } : {}) } : { status: 'running' };
    },
  },
  {
    name: 'delete_automation',
    title: 'Delete an automation',
    description: 'Delete an automation by id. Boards it already filled stay.',
    input: z.object({ id: z.string().uuid() }),
    readOnly: false,
    run: async (c, a) => automations(c, 'delete', { id: a.id }),
  },
  {
    name: 'update_slate',
    title: 'Update slate',
    description:
      'Update a slate. Passing data REPLACES the whole data object (validated against the kind), so expected_version (the version from get_slate) is REQUIRED with data: if the slate changed since you read it you get a conflict, so re-read and retry. To change a few items prefer patch_items, which merges.',
    input: z.object({
      slug,
      title: z.string().min(1).max(120).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
      icon: z.enum(ICON_NAMES).nullable().optional().describe('Icon name from the allowed list; null resets to the kind icon. Never use emoji.'),
      category: z.string().max(40).nullable().optional().describe('Move to a Boards category; null clears it.'),
      pinned: z.boolean().optional(),
      hidden: z.boolean().optional(),
      expected_version: z.number().int().optional(),
      note: z.string().max(300).optional(),
    }),
    readOnly: false,
    run: async (c, { slug: s, ...rest }) => {
      if (rest.data !== undefined && rest.expected_version === undefined) {
        const cur = await slates.get(c, s);
        throw new SlatesError(`version conflict: replacing data needs expected_version. The slate is at version ${cur.version}. Re-read it with get_slate, apply your change to what is there, and send expected_version: ${cur.version} (or use patch_items to merge).`, 409, 'conflict');
      }
      return withUrl(await slates.update(c, s, rest));
    },
  },
  {
    name: 'get_app_layout',
    title: 'Get app layout',
    description: `Returns pins (the user's shortcuts in the Apps sheet) and the colour. The bottom bar is fixed (Today, Ask, Apps); tabs, shortcuts and home are kept for older setups and are not shown. Read how the user's app is arranged: the ${MAX_TABS} tabs in the bottom bar, the shortcuts the Apps button opens, and the home screen (blocks and quick buttons). Returns the saved layout (or the defaults) and which places exist: ${ROUTE_TAB_IDS.join(', ')}. A board can also be a tab or shortcut by slug. Settings is always in the Apps grid; admin only shows for admins and is ignored for everyone else.`,
    input: z.object({}),
    readOnly: true,
    run: async (c: Caller) => {
      const { data, error } = await c.client.rpc('layout_get', { p_token: c.token });
      if (error) throw new SlatesError(error.message, 500, 'server_error');
      const layout = parseLayout(data);
      return { pins: layout.pins ?? [], tabs: layout.tabs ?? DEFAULT_TABS, shortcuts: layout.shortcuts ?? DEFAULT_SHORTCUTS, home: { blocks: layout.home?.blocks ?? DEFAULT_HOME_BLOCKS, quick: layout.home?.quick ?? DEFAULT_QUICK, dashboard: layout.home?.dashboard ?? null }, quick_buttons: QUICK_IDS, palette: layout.palette ?? DEFAULT_PALETTE, accent: layout.accent ?? null, palettes: PALETTE_IDS, places: ROUTE_TAB_IDS, max_tabs: MAX_TABS, max_shortcuts: MAX_SHORTCUTS, is_default: !data };
    },
  },
  {
    name: 'set_app_layout',
    title: 'Set app layout',
    description: `What still has an effect: pins (the user's shortcuts in the Apps sheet; adding a board they use a lot is welcome, removing needs their say) and palette/accent. The bottom bar is fixed (Today, Ask, Apps) and Today is generated, so tabs, shortcuts and home are stored but not shown. Change how the user's app is arranged. Keep Home small: at most ${MAX_HOME_BLOCKS} home blocks (brief, since, plus up to 3 pinned boards/widgets) so it fits one phone screen; ask before adding more than one pin. tabs = the ${MAX_TABS} always-visible bottom tabs; shortcuts = up to ${MAX_SHORTCUTS} items the Apps button opens as an animated grid. Each entry is {"type":"route","id":"${ROUTE_TAB_IDS.join('|')}"} or {"type":"board","slug":"<board slug>"}. home = what sits on the Home screen: blocks (ordered: {"type":"brief"}, {"type":"since"}, {"type":"board","slug"}, {"type":"widget","slug":"<dashboard>","widget":"<widget id>"}; max ${MAX_HOME_BLOCKS}), quick (1-3 of ${QUICK_IDS.join('|')}), dashboard (a dashboard slug to use as the whole home, or null). palette = the colour palette for the whole app (${PALETTE_IDS.join('|')}). Only the fields you send change (home is replaced as a whole). Ask the user before reshuffling their tabs or home; shortcuts are the safe place to add a board they use a lot. Needs a write token without a board limit.`,
    input: z.object({
      tabs: z.array(TabSchema).min(2).max(MAX_TABS).optional(),
      shortcuts: z.array(TabSchema).max(MAX_SHORTCUTS).optional(),
      pins: z.array(PinSchema).max(MAX_PINS).optional().describe('The user\'s shortcuts in the Apps sheet: boards ({type:"board",slug}) or notes ({type:"note",id}). Replaces the list; read it first with get_app_layout.'),
      home: HomeSchema.optional(),
      palette: z.enum(PALETTE_IDS).optional().describe(`Colour palette for the whole app: ${PALETTE_IDS.join(', ')}. lime is the default. Clears a custom accent.`),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Custom palette from ONE colour, e.g. "#6d8cff": Slates generates the light and dark colour sets and keeps text readable. Use it for "match my brand colour". Replaces the palette.'),
    }),
    readOnly: false,
    run: async (c: Caller, a: any) => {
      const { data: cur, error: e1 } = await c.client.rpc('layout_get', { p_token: c.token });
      if (e1) throw new SlatesError(e1.message, 500, 'server_error');
      const merged = AppLayoutSchema.safeParse({ ...parseLayout(cur), ...(a.tabs ? { tabs: a.tabs } : {}), ...(a.shortcuts ? { shortcuts: a.shortcuts } : {}), ...(a.pins ? { pins: a.pins } : {}), ...(a.home ? { home: a.home } : {}), ...(a.accent ? { accent: a.accent.toLowerCase(), palette: undefined } : a.palette ? { palette: a.palette, accent: undefined } : {}), v: 1 });
      if (!merged.success) throw new SlatesError('Invalid layout', 422, 'invalid');
      if ((a.home?.blocks?.length ?? 0) > MAX_HOME_BLOCKS) {
        throw new SlatesError(`Home holds at most ${MAX_HOME_BLOCKS} blocks (brief, since, and up to 3 pinned boards or widgets) so it always fits one screen. Send fewer, or leave the extras on a board.`, 422, 'invalid');
      }
      // Board entries must exist, so a typo never leaves a dead tab.
      const known = new Set((await slates.list(c)).map((b) => b.slug));
      const homeRefs = [...(merged.data.home?.blocks ?? []), ...(merged.data.home?.dashboard ? [{ type: 'board' as const, slug: merged.data.home.dashboard }] : [])].filter((b: any) => b.type === 'board' || b.type === 'widget');
      const missing = [...(merged.data.tabs ?? []), ...(merged.data.shortcuts ?? []), ...homeRefs].filter((t: any) => (t.type === 'board' || t.type === 'widget') && !known.has(t.slug));
      if (missing.length) throw new SlatesError(`Unknown board slug(s): ${missing.map((t: any) => t.slug).join(', ')}`, 422, 'invalid');
      const { error } = await c.client.rpc('layout_set', { p_layout: merged.data, p_token: c.token });
      if (error) {
        const code = (error as any).code;
        throw new SlatesError(error.message, code === 'P0403' ? 403 : code === 'P0422' ? 422 : 500, code === 'P0403' ? 'forbidden' : 'invalid');
      }
      const out = parseLayout(merged.data);
      return { pins: out.pins ?? [], tabs: out.tabs ?? DEFAULT_TABS, shortcuts: out.shortcuts ?? DEFAULT_SHORTCUTS, home: out.home ?? null, palette: out.palette ?? DEFAULT_PALETTE, accent: out.accent ?? null };
    },
  },
  {
    name: 'set_layout',
    title: 'Set dashboard layout',
    description:
      'Rearrange and restyle a dashboard without touching its data: order (widget ids in display order), per-widget size (s|m|l|xl), view (auto|ring|bars|heatmap|dots|compact), hidden, section heading, and the overall look (cards|compact|focus). Use null to reset a field. Example: put habits first as a heatmap, make the money chart full width, hide the old links.',
    input: z.object({
      slug,
      look: z.enum(DASHBOARD_LOOKS).nullable().optional(),
      order: z.array(z.string()).max(24).optional().describe('Widget ids in the order they should appear.'),
      widgets: z
        .array(
          z.object({
            id: z.string(),
            size: z.enum(WIDGET_SIZES).nullable().optional(),
            view: z.enum(WIDGET_VIEWS).nullable().optional(),
            hidden: z.boolean().nullable().optional(),
            section: z.string().max(40).nullable().optional(),
          }),
        )
        .max(24)
        .optional(),
      expected_version: z.number().int().optional(),
    }),
    readOnly: false,
    run: async (c: Caller, { slug: s, expected_version, ...patch }: any) => {
      const cur = await slates.get(c, s);
      if (cur.kind !== 'dashboard') throw new SlatesError('set_layout only works on dashboards', 422, 'invalid');
      let data;
      try {
        data = applyLayout(cur.data, patch);
      } catch (e: any) {
        throw new SlatesError(e.message, 422, 'invalid');
      }
      return withUrl(await slates.update(c, s, { data, expected_version: expected_version ?? cur.version, note: 'Changed the layout' }));
    },
  },
  {
    name: 'patch_items',
    title: 'Patch slate items',
    description:
      `Add, update or remove items in a slate by id (${COLLECTIONS}). Upserted items are merged into existing ones with the same id, so {"id":"x","done":true} ticks an item. New ids are appended, or prepended when prepend is true.`,
    input: z.object({
      slug,
      upsert: z.array(item).max(500).optional(),
      remove: z.array(z.string()).max(500).optional(),
      prepend: z.boolean().optional(),
      expected_version: z.number().int().optional().describe('If set, fail with a conflict instead of merging when the slate changed since you read it.'),
      note: z.string().max(300).optional(),
    }),
    readOnly: false,
    run: async (c, { slug: s, ...rest }) => withUrl(await slates.patchItems(c, s, rest)),
  },
  {
    name: 'set_today_brief',
    title: "Set today's brief",
    description:
      "Replace the daily brief shown at the top of the home screen (slate \"today\", created if missing). Use for morning summaries: date, an optional headline and up to 50 priorities.",
    input: z.object({
      date: z.string().max(60).optional(),
      headline: z.string().max(200).optional(),
      items: z
        .array(
          z.object({
            id: z.string().optional(),
            text: z.string().min(1).max(500),
            tone: z.enum(['neutral', 'good', 'warn', 'bad']).optional(),
            done: z.boolean().optional(),
          }),
        )
        .max(50),
      notify: z.boolean().optional().describe('Also push a notification to the user. Default false: routine syncs stay silent.'),
    }),
    readOnly: false,
    run: async (c, a) => {
      const data = {
        ...(a.date ? { date: a.date } : {}),
        ...(a.headline ? { headline: a.headline } : {}),
        items: a.items.map((it: { id?: string }, i: number) => ({ ...it, id: it.id || `b${i + 1}` })),
      };
      let result;
      try {
        await slates.get(c, 'today');
        result = await slates.update(c, 'today', { data, note: 'Updated the daily brief' });
      } catch (e: any) {
        if (e?.status !== 404) throw e;
        result = await slates.create(c, { slug: 'today', title: 'Today', kind: 'brief', data, pinned: true, note: 'Set the daily brief' });
      }
      if (c.token && a.notify === true) {
        // Best effort: a push failure never fails the brief update.
        const first = a.items.find((i: { done?: boolean }) => !i.done)?.text;
        await agentNotify(c, 'brief', { title: a.headline || "Today's brief is ready", body: first, url: '/home', tag: 'brief' }).catch(
          (e) => console.error('[push] brief', e?.message),
        );
      }
      return withUrl(result);
    },
  },
  {
    name: 'archive_slate',
    title: 'Archive slate',
    description: 'Ask to archive a slate. It is NOT archived right away: the user gets an approval in Today and it happens when they approve. The outcome shows up in check_desk.',
    input: z.object({ slug, note: z.string().max(300).optional().describe('Why, in a few words. Shown to the user.') }),
    readOnly: false,
    run: async (c, a) => {
      if (!c.token) return slates.archive(c, a.slug, a.note);
      const s = await slates.get(c, a.slug);
      const item = await desk.add(c, 'approval', { text: `Archive the board "${s.title}"`, context: a.note, action: { tool: 'archive_slate', args: { slug: a.slug } } });
      return { status: 'pending_approval', id: item.id, message: 'Not archived yet. The user has been asked to approve it in Today; check_desk shows their decision.' };
    },
  },
  {
    name: 'reorder_slates',
    title: 'Reorder slates',
    description: 'Set display order. Pass slugs in the desired order; unlisted slates keep their position.',
    input: z.object({ slugs: z.array(z.string()).min(1).max(500) }),
    readOnly: false,
    run: (c, a) => slates.reorder(c, a.slugs),
  },
  {
    name: 'add_note',
    title: 'Add note',
    description:
      'Write a note to the Notes board: meeting notes, plans, research, ideas, summaries, anything longer than a line or two. ALL notes go here, never into a dashboard or a new board. The body is Markdown read on a phone: use short sections, - [ ] checklists (the user ticks them in place), > quotes, and images as ![alt](https://...) with a public https URL. Live blocks: a fenced ```chart block holding chart JSON (same shape as a chart board: type, labels, series) draws a chart, and a fenced ```board block holding a board slug, or slug/widget-id, shows that board or widget live inside the note. Returns the note id and url; to show it on a dashboard, add a widget {"kind":"note","data":{"note":"<id>"}}. Passing an existing id updates that note (safe to retry).',
    input: z.object({
      title: z.string().min(1).max(120),
      body: z.string().max(20000).describe('Markdown.'),
      id: z.string().max(64).optional().describe('Stable id (lowercase, digits, dashes). Derived from the title when omitted.'),
      tags: z.array(z.string().min(1).max(24)).max(8).optional().describe('Short topic tags, e.g. ["work", "launchreel"]. Reuse existing tags from find_notes.'),
      pinned: z.boolean().optional(),
    }),
    readOnly: false,
    run: async (c, a) => summaryOf(await notes.add(c, a)),
  },
  {
    name: 'update_note',
    title: 'Update note',
    description: 'Change a note by id: replace its title/body/tags, pin it, or append text to the end (append is best for running logs and never needs a version). Replacing body REQUIRES expected_version (board_version from get_note) so you do not overwrite someone else\'s edit.',
    input: z.object({
      id: z.string().max(64),
      title: z.string().min(1).max(120).optional(),
      body: z.string().max(20000).optional().describe('Replaces the whole body.'),
      append: z.string().max(10000).optional().describe('Added as a new paragraph at the end.'),
      tags: z.array(z.string().min(1).max(24)).max(8).optional(),
      pinned: z.boolean().optional(),
      expected_version: z.number().int().optional().describe('board_version from get_note; fail on concurrent edits instead of merging.'),
    }),
    readOnly: false,
    run: async (c, { id, ...rest }) => {
      if (rest.body !== undefined && rest.expected_version === undefined) {
        const n = await notes.get(c, id);
        throw new SlatesError(`version conflict: replacing body needs expected_version. Notes is at version ${n.board_version}. Re-read with get_note, apply your change to the current text, and send expected_version: ${n.board_version} (or use append).`, 409, 'conflict');
      }
      return summaryOf(await notes.update(c, id, rest));
    },
  },
  {
    name: 'find_notes',
    title: 'Find notes',
    description: 'Search notes by text and/or tag. Returns id, title, a snippet, tags and url (not the full body); pinned first, then newest. Call before add_note to avoid duplicates.',
    input: z.object({
      query: z.string().max(200).optional(),
      tag: z.string().max(24).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    readOnly: true,
    run: (c, a) => notes.find(c, a),
  },
  {
    name: 'get_note',
    title: 'Get note',
    description: 'Read one note in full by id.',
    input: z.object({ id: z.string().max(64) }),
    readOnly: true,
    run: async (c, a) => ({ ...(await notes.get(c, a.id)), url: noteUrl(a.id) }),
  },
  {
    name: 'delete_note',
    title: 'Delete note',
    description: 'Ask to delete a note by id. It is NOT deleted right away: the user gets an approval in Today and it happens when they approve. The outcome shows up in check_desk.',
    input: z.object({ id: z.string().max(64), note: z.string().max(300).optional().describe('Why, in a few words. Shown to the user.') }),
    readOnly: false,
    run: async (c, a) => {
      if (!c.token) return notes.remove(c, a.id);
      const n = await notes.get(c, a.id);
      const item = await desk.add(c, 'approval', { text: `Delete the note "${n.title}"`, context: a.note, action: { tool: 'delete_note', args: { id: a.id } } });
      return { status: 'pending_approval', id: item.id, message: 'Not deleted yet. The user has been asked to approve it in Today; check_desk shows their decision.' };
    },
  },
  {
    name: 'notify',
    title: 'Notify the user',
    description:
      "Send a push notification to the user's phone. Use sparingly, for things that need attention now (a due payment, a finished long task). Max 20/hour; the user can turn agent notifications off.",
    input: z.object({
      title: z.string().min(1).max(120),
      body: z.string().max(300).optional(),
      slug: z.string().optional().describe('Open this slate when the notification is tapped.'),
    }),
    readOnly: false,
    run: (c, a) => agentNotify(c, 'agent', { title: a.title, body: a.body, url: a.slug ? `/s/${a.slug}` : '/home' }),
  },
  {
    name: 'remind',
    title: 'Set a reminder',
    description:
      'Schedule a reminder that pushes a notification to the user at a time (and shows in their Today list). Use for "remind me / notify me at ...". at must be ISO 8601 with a timezone offset, e.g. 2026-11-04T18:00:00+05:30; call list_reminders first to get the current time and the user\'s timezone. Optional repeat: daily, weekdays, weekly, monthly.',
    input: z.object({
      text: z.string().min(1).max(200).describe('What to remind about, short, e.g. "Call the bank".'),
      at: z.string().min(10).max(40).describe('ISO 8601 date-time with offset.'),
      repeat: z.enum(['daily', 'weekdays', 'weekly', 'monthly']).optional(),
      slug: z.string().optional().describe('Open this slate when the notification is tapped.'),
      timezone: z.string().max(64).optional().describe("IANA zone for repeats; defaults to the user's."),
    }),
    readOnly: false,
    run: (c, a) => reminders.create(c, a),
  },
  {
    name: 'list_reminders',
    title: 'List reminders',
    description: "Open reminders, soonest first, plus the current time and the user's timezone (use them to compute 'at' for remind).",
    input: z.object({ include_done: z.boolean().optional() }),
    readOnly: true,
    run: async (c, a) => {
      const [ctx, list] = await Promise.all([reminders.context(c), reminders.list(c, a)]);
      return { ...ctx, reminders: list };
    },
  },
  {
    name: 'complete_reminder',
    title: 'Complete reminder',
    description: 'Tick a reminder off. Repeating reminders roll forward to their next time.',
    input: z.object({ id: z.string().uuid() }),
    readOnly: false,
    run: (c, a) => reminders.complete(c, a.id),
  },
  {
    name: 'cancel_reminder',
    title: 'Cancel reminder',
    description: 'Delete a reminder (and all its future repeats).',
    input: z.object({ id: z.string().uuid() }),
    readOnly: false,
    run: (c, a) => reminders.cancel(c, a.id),
  },
  {
    name: 'capture',
    title: 'Capture to Inbox',
    description:
      'Drop something into the user\'s Inbox to sort later: a link, a thought, a snippet. Use when you are unsure which board it belongs on. Items are filed later with file_inbox_item.',
    input: z.object({
      text: z.string().min(1).max(500),
      url: z.string().url().max(2048).optional(),
      detail: z.string().max(1000).optional(),
      source: z.string().max(60).optional().describe('Where it came from, e.g. "Gmail".'),
    }),
    readOnly: false,
    run: (c, a) => inbox.capture(c, a),
  },
  {
    name: 'list_inbox',
    title: 'List Inbox',
    description: 'Items waiting in the Inbox (captured from the share sheet, the app or agents), newest first.',
    input: z.object({}),
    readOnly: true,
    run: (c) => inbox.list(c),
  },
  {
    name: 'file_inbox_item',
    title: 'File Inbox item',
    description:
      'Move an Inbox item to where it belongs: a list, links or tracker board (slug), or into Notes (note: true, optional tags). Removes it from the Inbox. Look at list_slates to pick the best board.',
    input: z.object({
      id: z.string().max(64),
      slug: z.string().optional(),
      note: z.boolean().optional(),
      tags: z.array(z.string().min(1).max(24)).max(8).optional(),
    }),
    readOnly: false,
    run: (c, { id, ...to }) => inbox.file(c, id, to),
  },
  {
    name: 'slate_history',
    title: 'Board history',
    description: 'List past versions of a board (newest first): version number, when, and who changed it. Use with restore_version to undo.',
    input: z.object({ slug, limit: z.number().int().min(1).max(60).optional() }),
    readOnly: true,
    run: (c, a) => history.versions(c, a.slug, a.limit),
  },
  {
    name: 'restore_version',
    title: 'Restore a version',
    description: 'Undo: put a board back the way it was at an earlier version (from slate_history). The restore itself is a new version, so it can be undone too.',
    input: z.object({ slug, version: z.number().int().min(1) }),
    readOnly: false,
    run: async (c, a) => withUrl(await history.restore(c, a.slug, a.version)),
  },
  {
    name: 'what_changed',
    title: 'What changed',
    description: 'Boards that agents changed since a time (ISO 8601), or since the user last opened Slates. Good for a "since you last looked" summary.',
    input: z.object({ since: z.string().max(40).optional() }),
    readOnly: true,
    run: (c, a) => history.changes(c, a.since),
  },
  {
    name: 'log_activity',
    title: 'Log activity',
    description:
      'Post a short note to the activity feed, e.g. "Synced 12 tasks from Google Tasks". Optionally attach it to a slate.',
    input: z.object({ message: z.string().min(1).max(500), slug: slug.optional() }),
    readOnly: false,
    run: (c, a) => slates.log(c, a.message, a.slug),
  },
  {
    name: 'recent_activity',
    title: 'Recent activity',
    description: 'Read the latest activity: what the user and each agent changed, newest first.',
    input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    readOnly: true,
    run: (c, a) => slates.activity(c, a.limit ?? 30),
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolJsonSchema(t: Tool) {
  const schema = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export const SERVER_INSTRUCTIONS = `Slates is the one place where the work of all the user's AI agents lands, stays, and is shared between them. The user mostly reads it on a phone; agents do most of the writing.
Start of every conversation: get_about_me (shared memory about the user), then check_desk (instructions the user left for agents, and their answers to earlier questions). Do open instructions and handoffs, and resolve_desk_item each one. The user tags tasks with @claude, @instinct and so on: a task tagged for you is yours to do first, and you reply with resolve_desk_item. Read last_sessions to continue where the previous agent stopped. Before a recurring job, list_playbooks and follow the user's own way of doing it. When you finish, end_session with what you did and what is still open; hand_off work that another agent is better placed to do. search finds where something already lives.
Shared memory: when you learn something durable about the user (a preference, project, person, routine), save it with remember so every other agent knows it too. If nothing is known yet, offer a two-minute interview and set up their first spaces from the answers.
The app: Today is generated (what needs the user, what changed and who changed it, what is coming up). Ask is the user's own assistant inside the app. Apps opens every feature plus the user's shortcuts (pins) to the boards and notes they open most. Spaces group things by area of life (Money, Work, Health): give every board a category with the space name, and tag notes with the same name, so they sit together. When the user wants a whole job run for them ("manage my dairy business", "track my fitness"), build_agent sets up a complete agent for it in one call.
Boards ("slates") are typed: ${KIND_LIST}. Pick the kind that fits; the user never has to. list_slates to see what exists -> describe_kinds before writing new data -> create_slate (with category) -> patch_items for small changes, update_slate to replace data (needs expected_version) -> log_activity with a short note of what you did.
Notes: every note, plan, summary or write-up goes on the Notes board via add_note (find_notes first to update instead of duplicating). Write for reading on a phone: short sections, - [ ] checklists. Never paste long text into a dashboard or make a board for a note.
Dashboards: for an overview, build ONE slate of kind "dashboard" with several widgets (metrics tiles first, then charts, tables, lists, links); patch widgets by id later. A {"kind":"note","data":{"note":"<note id>"}} widget links a note. Use set_layout to arrange widgets; prefer rings for goals and heatmaps for habits.
Two-way: when you need a decision and it can wait, ask_user (shows under "Needs you" in Today). Archiving a board or deleting a note is never immediate: the user approves it in Today. Use notify only for something that needs the user right now, and remind to ping them later. set_today_brief writes the day's plan shown at the top of Today.
Inbox: quick captures land in the Inbox (list_inbox). File each into the right board or Notes with file_inbox_item.
Trust: every change is versioned and shows who made it. slate_history + restore_version undo a bad write. Keep item ids stable so later updates merge instead of duplicating. Keep text concise.`;
