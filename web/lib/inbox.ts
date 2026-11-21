import { slates, SlatesError, type Caller } from '@/lib/slates';
import type { FileRefT, ListData, Slate } from '@/lib/kinds';
import { notes } from '@/lib/notes';

/**
 * Inbox: one list board (slug "inbox") where quick captures land: shared links, text,
 * screenshots. Filing moves an item to the right board (or into Notes) and removes it here.
 */
export const INBOX_SLUG = 'inbox';

export type Capture = { text: string; url?: string; detail?: string; files?: FileRefT[]; source?: string };

async function ensure(c: Caller): Promise<Slate> {
  try {
    return await slates.get(c, INBOX_SLUG);
  } catch (e) {
    if (!(e instanceof SlatesError && e.status === 404)) throw e;
  }
  try {
    return await slates.create(c, { slug: INBOX_SLUG, title: 'Inbox', kind: 'list', data: { items: [] }, icon: 'mail', note: 'Created the Inbox' });
  } catch (e) {
    if (e instanceof SlatesError && e.status === 409) return slates.get(c, INBOX_SLUG);
    throw e;
  }
}

const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Turn whatever the share sheet sent into a tidy item. */
export function captureItem(input: Capture) {
  const text = (input.text ?? '').trim();
  const url = input.url?.trim() || text.match(/https?:\/\/\S+/)?.[0];
  const title = (url && text === url ? hostOf(url) : text.replace(url ?? '\u0000', '').trim()) || (input.files?.[0]?.name ?? 'Captured');
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    text: cut(title, 500)!,
    ...(input.detail ? { detail: cut(input.detail, 1000) } : {}),
    ...(url && /^https?:\/\//.test(url) ? { href: url.slice(0, 2048) } : {}),
    meta: cut(input.source ?? 'Captured', 120),
    ...(input.files?.length ? { files: input.files.slice(0, 10) } : {}),
  };
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

export const inbox = {
  async list(c: Caller) {
    try {
      return ((await slates.get(c, INBOX_SLUG)).data as ListData).items;
    } catch (e) {
      if (e instanceof SlatesError && e.status === 404) return [];
      throw e;
    }
  },

  async capture(c: Caller, input: Capture) {
    if (!input.text?.trim() && !input.url && !input.files?.length) throw new SlatesError('Nothing to capture', 422, 'invalid');
    await ensure(c);
    const item = captureItem(input);
    await slates.patchItems(c, INBOX_SLUG, { upsert: [item], prepend: true, note: `Captured "${cut(item.text, 60)}"` });
    return item;
  },

  /** Move an inbox item to a board (list, brief, links, tracker) or into Notes. */
  async file(c: Caller, id: string, to: { slug?: string; note?: boolean; tags?: string[] }) {
    const items = await inbox.list(c);
    const it = items.find((x) => x.id === id);
    if (!it) throw new SlatesError(`No inbox item "${id}"`, 404, 'not_found');
    let where: string;
    if (to.note) {
      const body = [it.detail, it.href].filter(Boolean).join('\n\n') || it.text;
      const n = await notes.add(c, { title: it.text.slice(0, 120), body, tags: to.tags });
      where = `Notes · ${n.title}`;
    } else if (to.slug) {
      if (to.slug === INBOX_SLUG) throw new SlatesError('Pick a board other than the Inbox', 422, 'invalid');
      const target = await slates.get(c, to.slug);
      const nid = it.id;
      let upsert: Record<string, unknown>;
      switch (target.kind) {
        case 'list':
        case 'brief':
          upsert = { id: nid, text: it.text, ...(target.kind === 'list' ? { detail: it.detail, href: it.href, files: it.files } : {}) };
          break;
        case 'links':
          if (!it.href) throw new SlatesError('Only items with a link can go to a links board', 422, 'invalid');
          upsert = { id: nid, title: it.text.slice(0, 200), url: it.href, detail: it.detail?.slice(0, 500) };
          break;
        case 'tracker': {
          const stage = (target.data as any).stages?.[0]?.id;
          upsert = { id: nid, title: it.text.slice(0, 200), stage, detail: it.detail, href: it.href };
          break;
        }
        default:
          throw new SlatesError(`Can't file into a ${target.kind} board; pick a list, links or tracker board, or Notes`, 422, 'invalid');
      }
      for (const k of Object.keys(upsert)) if (upsert[k] === undefined) delete upsert[k];
      await slates.patchItems(c, to.slug, { upsert: [upsert], note: `Filed "${cut(it.text, 60)}" from the Inbox` });
      where = target.title;
    } else {
      throw new SlatesError('Say where to file it: a board slug, or note: true', 422, 'invalid');
    }
    await slates.patchItems(c, INBOX_SLUG, { remove: [id], note: `Filed to ${where}` });
    return { filed: id, to: where };
  },
};
