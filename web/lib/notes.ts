import { NOTES_SLUG, validateData, type Note, type NotesData, type Slate } from '@/lib/kinds';
import { slates, SlatesError, type Caller } from '@/lib/slates';
import { notePath, snippet, sortNotes } from '@/lib/notes-shared';
import { SITE_URL } from '@/lib/env';

/**
 * Notes: every note lives on one board (slug "notes", kind "notes").
 * Dashboards link to a note by id with a "note" widget instead of copying its text.
 */

export const noteUrl = (id: string) => `${SITE_URL}/notes/${id}`;
export { notePath, snippet, sortNotes };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function noteIdFrom(title: string) {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'note';
}

/** The Notes board, or null when nobody has written a note yet. */
export async function getBoard(c: Caller): Promise<Slate | null> {
  try {
    return await slates.get(c, NOTES_SLUG);
  } catch (e) {
    if (e instanceof SlatesError && e.status === 404) return null;
    throw e;
  }
}

async function ensureBoard(c: Caller): Promise<Slate> {
  const b = await getBoard(c);
  if (b) {
    if (b.kind !== 'notes') throw new SlatesError(`The "${NOTES_SLUG}" slug is taken by a ${b.kind} board. Rename that board first.`, 409, 'conflict');
    return b;
  }
  try {
    return await slates.create(c, { title: 'Notes', slug: NOTES_SLUG, kind: 'notes', data: { items: [] }, note: 'Created the Notes board' });
  } catch (e) {
    // Two writers raced to create it: use the winner's.
    if (e instanceof SlatesError && e.status === 409) return slates.get(c, NOTES_SLUG);
    throw e;
  }
}

export const notesOf = (b: Slate | null): Note[] => ((b?.data as NotesData | undefined)?.items ?? []) as Note[];

/** Read-modify-write on the notes array with optimistic concurrency. */
async function mutate(c: Caller, fn: (items: Note[]) => { items: Note[]; note: string }, expected?: number): Promise<Slate> {
  for (let attempt = 0; ; attempt++) {
    const board = await ensureBoard(c);
    if (expected !== undefined && board.version !== expected) {
      throw new SlatesError(`version conflict: Notes is at version ${board.version}, you sent ${expected}. Re-read and retry.`, 409, 'conflict');
    }
    const { items, note } = fn(notesOf(board));
    const data = validateData('notes', { items });
    try {
      return await slates.update(c, NOTES_SLUG, { data, expected_version: board.version, note });
    } catch (e) {
      if (e instanceof SlatesError && e.status === 409 && expected === undefined && attempt < 3) continue;
      throw e;
    }
  }
}

async function author(c: Caller) {
  if (!c.token) return 'You';
  try {
    return (await slates.whoami(c)).agent_name ?? undefined;
  } catch {
    return undefined;
  }
}

export type NoteInput = { id?: string; title: string; body: string; tags?: string[]; pinned?: boolean };

export const notes = {
  async list(c: Caller) {
    return sortNotes(notesOf(await getBoard(c)));
  },

  async get(c: Caller, id: string) {
    const board = await getBoard(c);
    const n = notesOf(board).find((x) => x.id === id);
    if (!n) throw new SlatesError(`No note with id "${id}". Use find_notes to look it up.`, 404, 'not_found');
    return { ...n, board_version: board!.version };
  },

  /** Create a note. Reusing an existing id updates that note instead (safe to retry). */
  async add(c: Caller, input: NoteInput) {
    if (input.id !== undefined && !ID_RE.test(input.id)) throw new SlatesError('note id must be lowercase letters, digits and dashes (max 64)', 422, 'invalid');
    const by = await author(c);
    let saved!: Note;
    await mutate(c, (items) => {
      let id = input.id ?? noteIdFrom(input.title);
      const existing = items.findIndex((x) => x.id === id);
      if (input.id === undefined && existing >= 0) {
        let n = 2;
        while (items.some((x) => x.id === `${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      const prev = input.id !== undefined ? items.find((x) => x.id === id) : undefined;
      saved = clean({ ...prev, id, title: input.title, body: input.body, tags: input.tags ?? prev?.tags, pinned: input.pinned ?? prev?.pinned, updated_at: new Date().toISOString(), by });
      return prev
        ? { items: items.map((x) => (x.id === id ? saved : x)), note: `Updated note "${saved.title}"` }
        : { items: [saved, ...items], note: `Added note "${saved.title}"` };
    });
    return saved;
  },

  async update(c: Caller, id: string, patch: { title?: string; body?: string; append?: string; tags?: string[]; pinned?: boolean; expected_version?: number }) {
    const by = await author(c);
    let saved!: Note;
    await mutate(
      c,
      (items) => {
        const prev = items.find((x) => x.id === id);
        if (!prev) throw new SlatesError(`No note with id "${id}". Use find_notes, or add_note to create it.`, 404, 'not_found');
        let body = patch.body ?? prev.body;
        if (patch.append) body = body.trimEnd() ? `${body.trimEnd()}\n\n${patch.append}` : patch.append;
        saved = clean({ ...prev, title: patch.title ?? prev.title, body, tags: patch.tags ?? prev.tags, pinned: patch.pinned ?? prev.pinned, updated_at: new Date().toISOString(), by });
        return { items: items.map((x) => (x.id === id ? saved : x)), note: `Updated note "${saved.title}"` };
      },
      patch.expected_version,
    );
    return saved;
  },

  async remove(c: Caller, id: string) {
    await mutate(c, (items) => {
      const prev = items.find((x) => x.id === id);
      if (!prev) throw new SlatesError(`No note with id "${id}"`, 404, 'not_found');
      return { items: items.filter((x) => x.id !== id), note: `Deleted note "${prev.title}"` };
    });
    return { deleted: id };
  },

  /** Search titles, tags and text. Returns summaries, not full bodies. */
  async find(c: Caller, opts: { query?: string; tag?: string; limit?: number } = {}) {
    const q = opts.query?.trim().toLowerCase();
    const tag = opts.tag?.trim().toLowerCase();
    return sortNotes(notesOf(await getBoard(c)))
      .filter((n) => !tag || n.tags?.some((t) => t.toLowerCase() === tag))
      .filter((n) => !q || `${n.title}\n${n.tags?.join(' ') ?? ''}\n${n.body}`.toLowerCase().includes(q))
      .slice(0, opts.limit ?? 50)
      .map(summaryOf);
  },
};

export function summaryOf(n: Note) {
  return { id: n.id, title: n.title, snippet: snippet(n.body), tags: n.tags, pinned: n.pinned, updated_at: n.updated_at, by: n.by, url: noteUrl(n.id) };
}

/** Drop undefined keys so stored JSON stays tidy. */
function clean(n: Note): Note {
  return Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)) as Note;
}
