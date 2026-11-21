'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { slates, toSlatesError, type Caller } from '@/lib/slates';
import type { Slate } from '@/lib/kinds';
import { isIconName } from '@/lib/icons';
import { applyLayout, type LayoutPatch } from '@/lib/layout';
import { z } from 'zod';
import { AppLayoutSchema, MAX_PINS, PinSchema, parseLayout, pinKey, resolvePins } from '@/lib/app-layout';
import { isSpaceBoard } from '@/lib/spaces';
import { notesOf } from '@/lib/notes';

type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function me(): Promise<Caller> {
  return { client: await supabaseServer(), token: null };
}

async function run<T>(fn: (c: Caller) => Promise<T>, paths: string[] = ['/home']): Promise<ActionResult<T>> {
  try {
    const data = await fn(await me());
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message };
  }
}

const slatePaths = (slug: string) => ['/home', '/spaces', '/boards', `/s/${slug}`, '/activity'];

export async function setFlag(slug: string, flag: 'pinned' | 'hidden', value: boolean) {
  return run((c) => slates.update(c, slug, { [flag]: value }), slatePaths(slug));
}

export async function setCategory(slug: string, category: string) {
  const c = category.trim().slice(0, 40);
  return run((c2) => slates.update(c2, slug, { category: c || null, note: c ? `Moved to ${c}` : 'Removed category' }), [
    ...slatePaths(slug),
    '/boards',
  ]);
}

export async function setIcon(slug: string, icon: string | null) {
  if (icon !== null && !isIconName(icon)) return { ok: false, error: 'Unknown icon' } as const;
  return run((c) => slates.update(c, slug, { icon, note: icon ? `Icon set to ${icon}` : 'Icon reset' }), [...slatePaths(slug)]);
}

export async function renameSlate(slug: string, title: string) {
  const t = title.trim();
  if (!t) return { ok: false, error: 'Title cannot be empty' } as const;
  return run((c) => slates.update(c, slug, { title: t.slice(0, 120) }), slatePaths(slug));
}

export async function archiveSlate(slug: string) {
  const res = await run((c) => slates.archive(c, slug), slatePaths(slug));
  if (res.ok) redirect('/home');
  return res;
}

export async function restoreSlate(slug: string) {
  return run((c) => slates.restore(c, slug), [...slatePaths(slug), '/settings']);
}

export async function deleteSlate(slug: string) {
  const res = await run((c) => slates.remove(c, slug), ['/home', '/activity', '/settings']);
  if (res.ok) redirect('/home');
  return res;
}

export async function moveSlate(slug: string, dir: -1 | 1) {
  return run(async (c) => {
    const all = (await slates.list(c)).map((s) => s.slug);
    const i = all.indexOf(slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    await slates.reorder(c, all);
  });
}

export async function toggleItem(slug: string, itemId: string, done: boolean, widgetId?: string) {
  const note = done ? 'Ticked an item' : 'Unticked an item';
  if (!widgetId) return run((c) => slates.patchItems(c, slug, { upsert: [{ id: itemId, done }], note }), slatePaths(slug));
  // A list inside a dashboard widget: patch the widget's items, keep everything else.
  return run(async (c) => {
    for (let attempt = 0; ; attempt++) {
      const s = await slates.get(c, slug);
      const widgets = ((s.data as any).widgets ?? []).map((w: any) =>
        w.id !== widgetId ? w : { ...w, data: { ...w.data, items: (w.data.items ?? []).map((i: any) => (i.id === itemId ? { ...i, done } : i)) } },
      );
      try {
        return await slates.update(c, slug, { data: { ...s.data, widgets }, expected_version: s.version, note });
      } catch (e: any) {
        if (e?.status === 409 && attempt < 3) continue;
        throw e;
      }
    }
  }, slatePaths(slug));
}

/** Save a dashboard's layout (order, sizes, views, hidden, look). Merges onto the latest version, so widget content is never overwritten. */
export async function saveDashboardLayout(slug: string, patch: LayoutPatch) {
  return run(async (c) => {
    for (let attempt = 0; ; attempt++) {
      const s = await slates.get(c, slug);
      if (s.kind !== 'dashboard') throw new Error('Only dashboards have a layout');
      try {
        return await slates.update(c, slug, { data: applyLayout(s.data, patch), expected_version: s.version, note: 'Changed the layout' });
      } catch (e: any) {
        if (e?.status === 409 && attempt < 3) continue;
        throw e;
      }
    }
  }, slatePaths(slug));
}

/** Save the app-wide layout (tabs, later home blocks and palette). Validated here and re-validated on read. */
export async function saveAppLayout(raw: unknown) {
  const parsed = AppLayoutSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'That layout is not valid' } as const;
  try {
    const sb = await supabaseServer();
    const { error } = await sb.rpc('layout_set', { p_layout: parsed.data });
    if (error) throw new Error(error.message);
    revalidatePath('/', 'layout');
    return { ok: true } as const;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}

/** Replace the shortcuts in the Apps sheet; the rest of the layout stays as it is. */
export async function savePins(raw: unknown) {
  const pins = z.array(PinSchema).max(MAX_PINS).safeParse(raw);
  if (!pins.success) return { ok: false, error: 'Those shortcuts are not valid' } as const;
  try {
    const sb = await supabaseServer();
    const { data } = await sb.from('user_settings').select('app_layout').maybeSingle();
    const { error } = await sb.rpc('layout_set', { p_layout: { ...parseLayout(data?.app_layout), pins: pins.data } });
    if (error) throw new Error(error.message);
    revalidatePath('/', 'layout');
    return { ok: true } as const;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}

/** Add a board or note to the Apps sheet's shortcuts, or take it out if it is already there. */
export async function toggleShortcut(raw: unknown) {
  const pin = PinSchema.safeParse(raw);
  if (!pin.success) return { ok: false, error: 'That cannot be a shortcut' } as const;
  try {
    const sb = await supabaseServer();
    const [{ data }, all] = await Promise.all([sb.from('user_settings').select('app_layout').maybeSingle(), slates.list({ client: sb, token: null })]);
    const layout = parseLayout(data?.app_layout);
    const boards = all.filter(isSpaceBoard).map((b) => ({ slug: b.slug, title: b.title, icon: b.icon ?? null, kind: b.kind as string, pinned: b.pinned }));
    const notes = notesOf(all.find((b) => b.kind === 'notes') ?? null).map((n) => ({ id: n.id, title: n.title }));
    const cur = resolvePins(layout, boards, notes).map((p) => p.pin);
    const key = pinKey(pin.data);
    const has = cur.some((p) => pinKey(p) === key);
    if (!has && cur.length >= MAX_PINS) return { ok: false, error: `You already have ${MAX_PINS} shortcuts. Remove one in Apps first.` } as const;
    const { error } = await sb.rpc('layout_set', { p_layout: { ...layout, pins: has ? cur.filter((p) => pinKey(p) !== key) : [...cur, pin.data] } });
    if (error) throw new Error(error.message);
    revalidatePath('/', 'layout');
    return { ok: true, on: !has } as const;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}

export async function moveTrackerItem(slug: string, itemId: string, stage: string) {
  return run((c) => slates.patchItems(c, slug, { upsert: [{ id: itemId, stage }], note: 'Moved a card' }), slatePaths(slug));
}

/** Tick or untick a habit for a day (YYYY-MM-DD in the user's own timezone). */
export async function toggleHabitDay(slug: string, habitId: string, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Bad day' } as const;
  return run(async (c) => {
    for (let attempt = 0; ; attempt++) {
      const s = await slates.get(c, slug);
      const items = ((s.data as any).items ?? []).map((h: any) =>
        h.id !== habitId ? h : { ...h, days: h.days.includes(day) ? h.days.filter((d: string) => d !== day) : [...h.days, day].sort().slice(-800) },
      );
      try {
        return await slates.update(c, slug, { data: { ...s.data, items }, expected_version: s.version, note: 'Ticked a habit' });
      } catch (e: any) {
        if (e?.status === 409 && attempt < 3) continue;
        throw e;
      }
    }
  }, slatePaths(slug));
}

export async function removeItem(slug: string, itemId: string) {
  return run((c) => slates.patchItems(c, slug, { remove: [itemId] }), slatePaths(slug));
}

export async function addListItem(slug: string, text: string) {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Write something first' } as const;
  return run(async (c) => {
    const s = await slates.get(c, slug);
    if (s.kind !== 'brief' && s.kind !== 'list') throw new Error('Quick add works on lists and briefs');
    const id = `u${Date.now().toString(36)}`;
    return slates.patchItems(c, slug, { upsert: [{ id, text: t.slice(0, 500) }], note: 'Added an item' });
  }, slatePaths(slug));
}

export async function saveMarkdown(slug: string, body: string, expectedVersion: number) {
  return run((c) => slates.update(c, slug, { data: { body }, expected_version: expectedVersion }), slatePaths(slug));
}

export async function createNote(title: string) {
  const t = title.trim() || 'Untitled';
  const res = await run((c) => slates.create(c, { title: t.slice(0, 120), kind: 'list', data: { items: [] }, note: 'Created by you' }));
  if (res.ok && res.data) redirect(`/s/${(res.data as Slate).slug}`);
  return res;
}

// ---------------------------------------------------------------- Agents

export async function createAgent(name: string, kind: string, readOnly: boolean, opts: { days?: number | null; boards?: string[] | null } = {}) {
  const n = name.trim();
  if (!n) return { ok: false, error: 'Give the agent a name' } as const;
  try {
    const sb = await supabaseServer();
    const { data, error } = await sb.rpc('create_agent', {
      p_name: n.slice(0, 60),
      p_kind: kind.replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'other',
      p_scopes: readOnly ? ['read'] : ['read', 'write'],
      p_days: opts.days ?? null,
      p_boards: opts.boards?.length ? opts.boards.slice(0, 100) : null,
    });
    if (error) throw new Error(error.message);
    revalidatePath('/agents');
    return { ok: true, data: data as { token: string; agent: { id: string; name: string } } } as const;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}

export async function revokeAgent(id: string) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('revoke_agent', { p_id: id });
  revalidatePath('/agents');
  return error ? ({ ok: false, error: error.message } as const) : ({ ok: true } as const);
}
