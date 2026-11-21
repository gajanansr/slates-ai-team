import 'server-only';
import { slates, type Caller } from '@/lib/slates';
import type { Slate } from '@/lib/kinds';
import { jev, pick, jevReady, type ChoiceQ } from '@/lib/jev';
import { parseReminder, isoInZone } from '@/lib/when';
import { reminders } from '@/lib/reminders';
import { inbox, INBOX_SLUG } from '@/lib/inbox';
import { searchAll } from '@/lib/search';
import { getBoard, notesOf } from '@/lib/notes';
import { summarize } from '@/lib/summary';
import { SITE_URL } from '@/lib/env';

/**
 * Ask routing. Jev (or, without it, a few patterns) decides what a request is and which board
 * it's about. Simple actions run here directly: no text model, no quota. Everything else goes
 * to the text model with only the tools it needs and a compact snapshot of the boards.
 */
export type Intent = 'add_item' | 'tick_item' | 'remind' | 'move_card' | 'file_inbox' | 'search' | 'question' | 'build_agent' | 'other';
export type Route = { intent: Intent; confidence: number; slug: string | null; boardConfidence: number; by: 'jev' | 'rules' };

const INTENTS: Record<Intent, string> = {
  add_item: 'Add one or more new items, tasks or things to a list or board (e.g. "add milk and eggs to groceries").',
  tick_item: 'Mark an existing item as done, complete or ticked off.',
  remind: 'Set a reminder or alarm for a specific time ("remind me at 6pm to call the bank").',
  move_card: 'Move a card to another stage or column on a tracker ("move Acme to interview").',
  file_inbox: 'Sort, file or clean up the Inbox.',
  search: 'Find, look up or open something by name ("where is my wifi password note", "open money").',
  question: 'A question about their own data: what is due, totals, amounts, status, summaries, what changed.',
  build_agent: 'Set up a whole agent to manage, run or track an area of their life or work ("manage my dairy business", "build me an agent that tracks my fitness", "run my launch for me").',
  other: 'Anything else: write or edit a note, create a board, several changes at once, advice, chit-chat.',
};

const boardsFor = (all: Slate[]) => all.filter((s) => !s.archived_at && s.kind !== 'notes').slice(0, 250);

/** "Hey Slates, manage my dairy business" / "build me an agent that…": Agent Studio. */
export const BUILD_AGENT_RE =
  /^\s*(?:(?:hey|hi|ok)\s+slates[\s,.!:]*)?(?:please\s+)?(?:(?:can|could|will|would)\s+you\s+)?(?:(?:manage|run|handle|look after|take care of)\s+my\s+(?!reminders?\b|inbox\b|notes?\b|boards?\b)\S|(?:build|make|create|set up|spin up)\s+(?:me\s+)?(?:an?|my)\s+(?:new\s+)?(?:[\w-]+\s+){0,3}agent\b)/i;

const RULES: [Intent, RegExp][] = [
  ['build_agent', BUILD_AGENT_RE],
  ['remind', /^\s*(?:please\s+)?(?:remind me|set (?:a|an) (?:reminder|alarm)|ping me|notify me)\b/i],
  ['file_inbox', /\b(?:file|sort|clean(?:\s+up)?|tidy|organi[sz]e)\b.*\binbox\b/i],
  ['move_card', /^\s*move\s+.+\s+to\s+/i],
  ['tick_item', /^\s*(?:tick(?:\s+off)?|check off|cross off|mark\s+.+\s+(?:as\s+)?(?:done|complete)|i (?:did|finished|bought|paid))\b/i],
  ['add_item', /^\s*(?:please\s+)?(?:add|put|append|jot down)\s+.+/i],
  ['search', /^\s*(?:find|search(?: for)?|where(?:'s| is| are)|open|show me)\b/i],
  ['question', /\?\s*$|^\s*(?:what|how|when|which|who|is|are|do|does|did|how much|how many)\b/i],
];

export async function route(q: string, all: Slate[]): Promise<Route> {
  const boards = boardsFor(all);
  if (jevReady()) {
    const criteria = Object.fromEntries(boards.map((b) => [b.slug, `${b.title} (${b.kind}${b.category ? `, ${b.category}` : ''})`]));
    const questions: Record<string, ChoiceQ> = {
      intent: { type: 'choice', instructions: 'What is the user asking their personal dashboard app to do?', criteria: INTENTS },
    };
    if (boards.length) questions.board = { type: 'choice', instructions: 'Which board is this request about?', criteria: { ...criteria, none: 'No specific board, or several boards' } };
    const a = await jev({ request: q }, questions);
    const intent = pick(a, 'intent');
    if (intent && intent.choice in INTENTS) {
      const b = pick(a, 'board');
      return {
        intent: intent.choice as Intent,
        confidence: intent.confidence,
        slug: b && b.choice !== 'none' && criteria[b.choice] ? b.choice : null,
        boardConfidence: b?.confidence ?? 0,
        by: 'jev',
      };
    }
  }
  const hit = RULES.find(([, re]) => re.test(q));
  const named = boardFromText(q, boards);
  return { intent: hit?.[0] ?? 'other', confidence: hit ? 0.8 : 0.3, slug: named?.slug ?? null, boardConfidence: named ? 0.8 : 0, by: 'rules' };
}

// ------------------------------------------------------------------ matching helpers

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
const STOP = new Set(['the', 'my', 'a', 'an', 'to', 'on', 'in', 'of', 'list', 'board', 'and', 'for']);

function similarity(a: string, b: string) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (nb.includes(na) || na.includes(nb)) return 0.85;
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w) || [...B].some((x) => x.startsWith(w) || w.startsWith(x))) n++;
  return n / Math.max(A.size, B.size);
}

function best<T>(needle: string, items: T[], text: (t: T) => string, min = 0.5) {
  let top: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = similarity(needle, text(item));
    if (score >= min && (!top || score > top.score)) top = { item, score };
  }
  return top?.item ?? null;
}

/** "…to my groceries list" -> the Groceries board, if a title matches. */
function boardFromText(q: string, boards: Slate[]) {
  const tail = q.match(/\b(?:to|on|in|into|from)\s+(?:my\s+|the\s+)?([^,.!?]+?)(?:\s+(?:list|board|tracker))?\s*[.!?]*$/i)?.[1];
  return tail ? best(tail, boards, (b) => b.title, 0.6) : null;
}

const clean = (s: string) => s.replace(/^["'“”‘’\s]+|["'“”‘’.!?\s]+$/g, '').trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const link = (b: Slate) => `[${b.title}](/s/${b.slug})`;

// ------------------------------------------------------------------ direct actions

export type Direct = { reply: string; tools: string[]; changed: boolean };

/** Handle simple actions without a text model. Returns null to hand over to the assistant. */
export async function direct(c: Caller, q: string, r: Route, all: Slate[], tz: string): Promise<Direct | null> {
  const confident = r.by === 'rules' ? r.confidence >= 0.8 : r.confidence >= 0.7;
  if (!confident) return null;
  const boards = boardsFor(all);
  const board = boardFromText(q, boards) ?? (r.slug && r.boardConfidence >= 0.6 ? boards.find((b) => b.slug === r.slug) ?? null : null);

  switch (r.intent) {
    case 'remind': {
      const p = parseReminder(q, tz);
      if (!p) return null;
      const iso = isoInZone(p.at, tz);
      await reminders.create(c, { text: p.text.slice(0, 200), at: iso, timezone: tz });
      const when = new Intl.DateTimeFormat('en', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(p.at);
      return { reply: `Done. I'll remind you to **${p.text}** on ${when}.`, tools: ['Set a reminder'], changed: true };
    }

    case 'add_item': {
      if (!board || !['list', 'brief', 'tracker'].includes(board.kind)) return null;
      const body = q.match(/^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:add|put|append|jot down)\s+(.+)$/i)?.[1];
      if (!body) return null;
      const split = body.match(/^(.*)\s+(?:to|on|in|into)\s+(?:my\s+|the\s+)?[^,]+$/i);
      const raw = clean(split ? split[1] : body);
      if (!raw || raw.length > 400) return null;
      const items = board.kind === 'list' && raw.length < 200 ? raw.split(/\s*,\s*|\s+and\s+/i).map(clean).filter(Boolean) : [raw];
      if (!items.length || items.length > 15) return null;
      const stamp = Date.now().toString(36);
      const stage = board.kind === 'tracker' ? (board.data as any).stages?.[0]?.id : undefined;
      const upsert = items.map((t, i) =>
        board.kind === 'tracker' ? { id: `a${stamp}${i}`, title: cap(t).slice(0, 200), stage } : { id: `a${stamp}${i}`, text: cap(t).slice(0, 500) },
      );
      await slates.patchItems(c, board.slug, { upsert, note: `Added ${items.length === 1 ? `"${cap(items[0]).slice(0, 60)}"` : `${items.length} items`} (Ask Slates)` });
      return { reply: `Added ${items.map((t) => `**${cap(t)}**`).join(', ')} to ${link(board)}.`, tools: ['Patch slate items'], changed: true };
    }

    case 'tick_item': {
      if (!board || !['list', 'brief'].includes(board.kind)) return null;
      const what = clean(
        q
          .replace(/^\s*(?:please\s+)?(?:tick(?:\s+off)?|check off|cross off|mark|i (?:did|finished|bought|paid))\s+/i, '')
          .replace(/\s+(?:as\s+)?(?:done|complete|completed|finished)\b.*$/i, '')
          .replace(/\s+(?:on|in|from)\s+(?:my\s+|the\s+)?[^,]+$/i, ''),
      );
      const open = ((board.data as any).items ?? []).filter((i: any) => !i.done);
      const item = what ? best(what, open, (i: any) => String(i.text), 0.5) : null;
      if (!item) return null;
      await slates.patchItems(c, board.slug, { upsert: [{ id: (item as any).id, done: true }], note: 'Ticked an item (Ask Slates)' });
      return { reply: `Ticked **${(item as any).text}** on ${link(board)}.`, tools: ['Patch slate items'], changed: true };
    }

    case 'move_card': {
      const m = q.match(/^\s*move\s+(.+?)\s+to\s+(?:the\s+)?(.+?)(?:\s+(?:stage|column))?\s*[.!?]*$/i);
      if (!m) return null;
      const trackers = board?.kind === 'tracker' ? [board] : boards.filter((b) => b.kind === 'tracker');
      for (const t of trackers) {
        const d = t.data as any;
        const card = best(clean(m[1]), d.items ?? [], (i: any) => String(i.title), 0.5) as any;
        const stage = best(clean(m[2]), d.stages ?? [], (s: any) => String(s.name), 0.6) as any;
        if (card && stage) {
          await slates.patchItems(c, t.slug, { upsert: [{ id: card.id, stage: stage.id }], note: `Moved "${card.title.slice(0, 60)}" to ${stage.name} (Ask Slates)` });
          return { reply: `Moved **${card.title}** to **${stage.name}** on ${link(t)}.`, tools: ['Patch slate items'], changed: true };
        }
      }
      return null;
    }

    case 'search': {
      const term = clean(q.replace(/^\s*(?:find|search(?: for)?|where(?:'s| is| are)|open|show me)\s+(?:my\s+|the\s+)?/i, ''));
      if (!term) return null;
      const [board2, open] = await Promise.all([getBoard(c).catch(() => null), reminders.list(c).catch(() => [])]);
      const hits = searchAll(term, all, notesOf(board2), open, 6);
      if (!hits.length) return null; // let the assistant try harder
      if (/^\s*open\b/i.test(q) && hits[0].kind === 'board') return { reply: `Here it is: [${hits[0].title}](${hits[0].href})`, tools: ['Search'], changed: false };
      return { reply: `Found:\n\n${hits.map((h) => `- [${h.title}](${h.href}) · ${h.kind === 'item' ? `in ${h.sub}` : h.sub}`).join('\n')}`, tools: ['Search'], changed: false };
    }

    case 'file_inbox': {
      const res = await fileInboxWithJev(c, all);
      if (!res) return null;
      return { reply: res.summary, tools: ['File Inbox item'], changed: res.filed > 0 };
    }

    default:
      return null;
  }
}

/** File every Inbox item with Jev: one decision per item (a board, Notes, or leave it). */
export async function fileInboxWithJev(c: Caller, all: Slate[]): Promise<{ filed: number; summary: string } | null> {
  if (!jevReady()) return null;
  const items = await inbox.list(c);
  if (!items.length) return { filed: 0, summary: 'Your Inbox is empty.' };
  const targets = boardsFor(all).filter((b) => b.slug !== INBOX_SLUG && ['list', 'tracker', 'links'].includes(b.kind));
  const criteria: Record<string, string> = {
    ...Object.fromEntries(targets.slice(0, 250).map((b) => [b.slug, `${b.title} (${b.kind}${b.category ? `, ${b.category}` : ''})`])),
    notes: 'Notes: longer text, ideas, plans, anything to keep and read later',
    keep: 'Unclear: leave it in the Inbox',
  };
  const moved: string[] = [];
  let kept = 0;
  for (const it of items.slice(0, 25)) {
    const a = await jev(
      { item: it.text, detail: it.detail ?? null, link: it.href ?? null },
      { where: { type: 'choice', instructions: 'Which board should this captured item be filed into?', criteria } },
    );
    const w = pick(a, 'where');
    if (!w || w.choice === 'keep' || w.confidence < 0.6) {
      kept++;
      continue;
    }
    const target = targets.find((b) => b.slug === w.choice);
    if (target?.kind === 'links' && !it.href) {
      kept++;
      continue;
    }
    try {
      await inbox.file(c, it.id, w.choice === 'notes' ? { note: true } : { slug: w.choice });
      moved.push(`**${it.text.slice(0, 60)}** → ${w.choice === 'notes' ? 'Notes' : target?.title}`);
    } catch {
      kept++;
    }
  }
  const summary = moved.length
    ? `Filed ${moved.length}:\n\n${moved.map((m) => `- ${m}`).join('\n')}${kept ? `\n\nLeft ${kept} in the [Inbox](/inbox) that I wasn't sure about.` : ''}`
    : `I wasn't sure where ${kept === 1 ? 'that item' : 'those items'} should go, so I left ${kept === 1 ? 'it' : 'them'} in the [Inbox](/inbox).`;
  return { filed: moved.length, summary };
}

// ------------------------------------------------------------------ text-model plan

/** The tools the text model gets for each kind of request (instead of all of them). */
export const TOOLS_FOR: Record<Intent, string[]> = {
  question: ['get_slate', 'find_notes', 'get_note', 'list_reminders', 'what_changed', 'recent_activity', 'list_inbox'],
  add_item: ['get_slate', 'patch_items', 'create_slate', 'add_note'],
  tick_item: ['get_slate', 'patch_items'],
  move_card: ['get_slate', 'patch_items'],
  remind: ['list_reminders', 'remind', 'complete_reminder', 'cancel_reminder'],
  file_inbox: ['list_inbox', 'file_inbox_item'],
  search: ['find_notes', 'get_note', 'get_slate', 'list_reminders'],
  build_agent: ['build_agent'],
  other: ['build_agent', 'get_slate', 'patch_items', 'update_slate', 'create_slate', 'add_note', 'update_note', 'find_notes', 'get_note', 'remind', 'list_reminders', 'capture', 'set_today_brief'],
};

/** Compact text view of a board for the prompt (ids kept so the model can patch). */
export function compactBoard(s: Slate, max = 3500) {
  const d = s.data as any;
  const lines: string[] = [`## ${s.title} (slug ${s.slug}, ${s.kind}, v${s.version})`];
  const row = (...xs: unknown[]) => xs.filter((x) => x !== undefined && x !== null && x !== '' && x !== false).join(' | ');
  for (const it of d.items ?? []) lines.push(`- ${row(it.id, it.text ?? it.title ?? it.label ?? it.name, it.value, it.meta ?? it.sub, it.stage, it.due ?? it.date ?? it.deadline, it.current !== undefined ? `${it.current}/${it.target}` : '', it.done && 'done')}`);
  for (const e of d.entries ?? []) lines.push(`- ${row(e.id, e.date, e.title, (e.items ?? []).join('; '))}`);
  if (d.columns) lines.push(`columns: ${d.columns.map((c: any) => c.label).join(' | ')}`);
  for (const r of d.rows ?? []) lines.push(`- ${row(r.id, ...Object.values(r.cells ?? {}))}`);
  for (const w of d.widgets ?? []) lines.push(`- widget ${w.id} "${w.title}" (${w.kind}): ${JSON.stringify(w.data).slice(0, 300)}`);
  if (d.series) lines.push(`labels: ${d.labels?.join(', ')}`, ...d.series.map((x: any) => `- ${x.name}: ${x.values.join(', ')}`));
  if (d.stages) lines.push(`stages: ${d.stages.map((x: any) => `${x.id}=${x.name}`).join(', ')}`);
  if (typeof d.body === 'string') lines.push(d.body);
  if (d.headline) lines.splice(1, 0, `headline: ${d.headline}`);
  const out = lines.join('\n');
  return out.length > max ? `${out.slice(0, max)}\n… (truncated; call get_slate for the rest)` : out;
}

/** What the text model sees up front, so most questions need no lookup calls. */
export function snapshot(all: Slate[], focus: string | null, now: string, tz: string) {
  const boards = boardsFor(all);
  const index = boards.map((b) => {
    const s = summarize(b);
    return `- ${b.slug} | ${b.title} | ${b.kind}${b.category ? ` | ${b.category}` : ''} | ${[s.stat, s.label].filter(Boolean).join(' ')}`;
  });
  const parts = [`Now: ${now} (${tz}). App: ${SITE_URL}. Link boards as [Title](/s/slug).`, `Boards (slug | title | kind | category | glance):\n${index.join('\n')}`];
  const f = focus ? boards.find((b) => b.slug === focus) : null;
  if (f) parts.push(`Most relevant board, full contents:\n${compactBoard(f)}`);
  return parts.join('\n\n');
}
