import { slates, SlatesError, type Caller } from '@/lib/slates';
import type { ListData, Slate } from '@/lib/kinds';
import { notes } from '@/lib/notes';

/**
 * The desk is where you and your agents leave things for each other:
 *   question    an agent asks you something; you answer from Today
 *   approval    an agent wants to do something you can't undo easily; you approve or decline
 *   instruction you leave a note for your agents (optionally about one board or note)
 *   handoff     one agent leaves a task for another (or for whichever agent connects next)
 *   session     an agent's closing note: what it did and what is still open, so the next one continues
 * It lives on one hidden list board (slug "desk"), like the Inbox, so it is versioned and
 * needs no schema of its own. Each item's details ride in `detail` as JSON.
 */
export const DESK_SLUG = 'desk';

export type DeskType = 'question' | 'approval' | 'instruction' | 'handoff' | 'session';
export type DeskTarget = { type: 'slate' | 'note'; id: string; title: string };
export type DeskAction = { tool: 'archive_slate' | 'delete_note'; args: Record<string, string> };
export type DeskItem = {
  id: string;
  type: DeskType;
  text: string;
  from: string;
  /** Open until you answer / decide, or until an agent handles the instruction. */
  open: boolean;
  context?: string;
  options?: string[];
  answer?: string;
  target?: DeskTarget;
  action?: DeskAction;
  /** Handoffs: the agent it is meant for (any agent when empty). */
  to?: string;
  at?: string;
};

const PREFIX: Record<DeskType, string> = { question: 'q', approval: 'ap', instruction: 'i', handoff: 'h', session: 's' };
const typeOf = (id: string): DeskType =>
  id.startsWith('ap-') ? 'approval' : id.startsWith('i-') ? 'instruction' : id.startsWith('h-') ? 'handoff' : id.startsWith('s-') ? 'session' : 'question';
const MAX_SESSIONS = 8;
const newId = (t: DeskType) => `${PREFIX[t]}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const MAX_ITEMS = 60;

type Raw = ListData['items'][number];

function parse(it: Raw): DeskItem {
  let extra: Partial<DeskItem> = {};
  try {
    extra = it.detail ? JSON.parse(it.detail) : {};
  } catch {
    /* hand-edited item: show the text as it is */
  }
  return { id: it.id, type: typeOf(it.id), text: it.text, from: it.meta ?? 'An agent', open: !it.done, ...extra };
}

function raw(d: DeskItem): Raw {
  const { context, options, answer, target, action, to, at } = d;
  const detail = JSON.stringify({ context, options, answer, target, action, to, at });
  return { id: d.id, text: d.text.slice(0, 500), meta: d.from.slice(0, 120), done: !d.open, ...(detail.length > 2 && detail.length <= 1000 ? { detail } : {}) };
}

async function ensure(c: Caller): Promise<Slate> {
  try {
    return await slates.get(c, DESK_SLUG);
  } catch (e) {
    if (!(e instanceof SlatesError && e.status === 404)) throw e;
  }
  try {
    const s = await slates.create(c, { slug: DESK_SLUG, title: 'Desk', kind: 'list', data: { items: [] }, icon: 'mail', note: 'Set up the desk' });
    await slates.update(c, DESK_SLUG, { hidden: true }).catch(() => undefined);
    return s;
  } catch (e) {
    if (e instanceof SlatesError && e.status === 409) return slates.get(c, DESK_SLUG);
    throw e;
  }
}

async function who(c: Caller) {
  if (!c.token) return 'You';
  try {
    return (await slates.whoami(c)).agent_name ?? 'An agent';
  } catch {
    return 'An agent';
  }
}

/** @claude, @instinct ... in what you wrote: who it is for. Letters and digits only, up to 3 agents. */
export function tagsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]{0,29})/gi)) {
    const t = m[2].toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 3);
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Is a task addressed to this agent? No `to` means any agent. "claude" reaches an agent named "Claude" or "Claude Code". */
export function addresses(to: string | undefined, me?: string) {
  if (!to || !me) return true;
  const mine = flat(me);
  return to.split(',').some((t) => {
    const f = flat(t);
    return !!f && (mine === f || mine.startsWith(f));
  });
}

const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const desk = {
  async list(c: Caller): Promise<DeskItem[]> {
    try {
      return ((await slates.get(c, DESK_SLUG)).data as ListData).items.map(parse);
    } catch (e) {
      if (e instanceof SlatesError && (e.status === 404 || e.status === 403)) return [];
      throw e;
    }
  },

  async add(c: Caller, type: DeskType, input: { text: string; context?: string; options?: string[]; target?: DeskTarget; action?: DeskAction; to?: string }) {
    const text = input.text.trim();
    if (!text) throw new SlatesError('Say something first', 422, 'invalid');
    const board = await ensure(c);
    const item: DeskItem = {
      id: newId(type),
      type,
      text,
      from: await who(c),
      open: type !== 'session',
      to: input.to?.trim().slice(0, 60) || undefined,
      context: cut(input.context?.trim() || undefined, 400),
      options: input.options?.map((o) => o.trim().slice(0, 60)).filter(Boolean).slice(0, 4),
      target: input.target ? { ...input.target, title: input.target.title.slice(0, 80) } : undefined,
      action: input.action,
      at: new Date().toISOString(),
    };
    // Keep the desk small: once it is full, the oldest settled items go first.
    const items = (board.data as ListData).items;
    const settled = items.filter((x) => x.done).map((x) => x.id);
    const over = items.length + 1 - MAX_ITEMS;
    // Only the latest few closing notes are worth keeping.
    const oldSessions = type === 'session' ? items.filter((x) => x.id.startsWith('s-')).slice(MAX_SESSIONS - 1).map((x) => x.id) : [];
    const remove = [...new Set([...oldSessions, ...(over > 0 ? settled.slice(-over) : [])])];
    await slates.patchItems(c, DESK_SLUG, { upsert: [raw(item)], prepend: true, remove: remove.length ? remove : undefined, note: `${item.from}: ${cut(text, 60)}` });
    return item;
  },

  async find(c: Caller, id: string) {
    const it = (await desk.list(c)).find((x) => x.id === id);
    if (!it) throw new SlatesError(`Nothing on the desk with id "${id}"`, 404, 'not_found');
    return it;
  },

  /** You answer a question. */
  async answer(c: Caller, id: string, answer: string) {
    const it = await desk.find(c, id);
    if (it.type !== 'question') throw new SlatesError('That is not a question', 422, 'invalid');
    const next = { ...it, open: false, answer: answer.trim().slice(0, 500) };
    await slates.patchItems(c, DESK_SLUG, { upsert: [raw(next)], note: `Answered "${cut(it.text, 60)}"` });
    return next;
  },

  /** You approve or decline what an agent asked to do. Approving does it, as you. */
  async decide(c: Caller, id: string, approve: boolean) {
    const it = await desk.find(c, id);
    if (it.type !== 'approval' || !it.action) throw new SlatesError('That is not an approval', 422, 'invalid');
    if (!it.open) return it;
    if (approve) {
      if (it.action.tool === 'archive_slate') await slates.archive(c, it.action.args.slug, `Approved: ${it.from} archived it`);
      if (it.action.tool === 'delete_note') await notes.remove(c, it.action.args.id);
    }
    const next = { ...it, open: false, answer: approve ? 'approved' : 'declined' };
    await slates.patchItems(c, DESK_SLUG, { upsert: [raw(next)], note: `${approve ? 'Approved' : 'Declined'} "${cut(it.text, 60)}"` });
    return next;
  },

  /** An agent says it handled your instruction (with a short reply), or clears something it has read. */
  async resolve(c: Caller, id: string, reply?: string) {
    const it = await desk.find(c, id);
    if ((it.type === 'instruction' || it.type === 'handoff') && it.open) {
      const by = await who(c);
      const next = { ...it, open: false, answer: cut(`${by}: ${reply?.trim() || 'done'}`, 500) };
      await slates.patchItems(c, DESK_SLUG, { upsert: [raw(next)], note: `${by} handled "${cut(it.text, 60)}"` });
      return { id, status: 'handled' };
    }
    if (it.open) throw new SlatesError('Still waiting for the user; it cannot be cleared yet', 409, 'conflict');
    await slates.patchItems(c, DESK_SLUG, { remove: [id], note: `Cleared "${cut(it.text, 60)}"` });
    return { id, status: 'cleared' };
  },

  async remove(c: Caller, id: string) {
    await slates.patchItems(c, DESK_SLUG, { remove: [id], note: 'Removed from the desk' });
  },
};

/**
 * What an agent should see when it sits down: your instructions, work other agents handed to it,
 * the answers it was waiting for, and how the last sessions ended.
 */
export function deskForAgent(items: DeskItem[], me?: string) {
  const mine = (i: DeskItem) => addresses(i.to, me);
  const settledQA = (i: DeskItem) => (i.type === 'question' || i.type === 'approval') && !i.open;
  return {
    instructions: items
      .filter((i) => i.type === 'instruction' && i.open && mine(i))
      .map((i) => ({ id: i.id, text: i.text, for: i.to ? i.to.split(',').map((t) => `@${t}`).join(' ') : 'any agent', about: i.target, at: i.at })),
    handoffs: items.filter((i) => i.type === 'handoff' && i.open && mine(i) && i.from !== me).map((i) => ({ id: i.id, from: i.from, to: i.to ?? 'any agent', task: i.text, context: i.context, at: i.at })),
    answers: items.filter(settledQA).map((i) => ({ id: i.id, type: i.type, asked_by: i.from, text: i.text, answer: i.answer })),
    waiting_on_user: items.filter((i) => (i.type === 'question' || i.type === 'approval') && i.open).map((i) => ({ id: i.id, type: i.type, asked_by: i.from, text: i.text })),
    last_sessions: items.filter((i) => i.type === 'session').slice(0, 5).map((i) => ({ agent: i.from, did: i.text, still_open: i.context, at: i.at })),
  };
}

export const whoIs = who;

/** Your notes to agents about one board or note, newest first: open ones, and the last few replies. */
export function toldAbout(items: DeskItem[], type: DeskTarget['type'], id: string) {
  return items
    .filter((i) => i.type === 'instruction' && i.target?.type === type && i.target.id === id)
    .slice(0, 5)
    .map((i) => ({ id: i.id, text: i.text, open: i.open, reply: i.answer, to: i.to }));
}

/** Questions and approvals that wait for the user, for Today. */
export function needsUser(items: DeskItem[]) {
  return items
    .filter((i) => (i.type === 'question' || i.type === 'approval') && i.open)
    .map((i) => ({ id: i.id, type: i.type as 'question' | 'approval', text: i.text, context: i.context, options: i.options, from: i.from }));
}
