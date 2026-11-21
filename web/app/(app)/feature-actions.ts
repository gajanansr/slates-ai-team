'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAnon, supabaseServer } from '@/lib/supabase/server';
import { runDueAutomations } from '@/lib/automations-run';
import { slates, toSlatesError, type Caller } from '@/lib/slates';
import { history } from '@/lib/history';
import { inbox, INBOX_SLUG } from '@/lib/inbox';
import { searchAll, type Hit } from '@/lib/search';
import { getBoard, notesOf } from '@/lib/notes';
import { reminders } from '@/lib/reminders';
import { TEMPLATES } from '@/lib/templates';
import { uploadFiles } from '@/lib/files';
import { automationsRpc, ensureAssistant, feedSlug, listAutomations, prepareAutomation, type AutomationKind } from '@/lib/automations';
import type { Slate } from '@/lib/kinds';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function me(): Promise<Caller> {
  return { client: await supabaseServer(), token: null };
}
async function run<T>(fn: (c: Caller) => Promise<T>, paths: string[] = []): Promise<Result<T>> {
  try {
    const data = await fn(await me());
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message };
  }
}

// ------------------------------------------------------------------ history

export async function listVersions(slug: string) {
  return run((c) => history.versions(c, slug, 40));
}

export async function restoreVersion(slug: string, version: number) {
  return run((c) => history.restore(c, slug, version), ['/home', '/boards', `/s/${slug}`, '/activity']);
}

// ------------------------------------------------------------------ sharing

export async function setShare(slug: string, on: boolean) {
  return run(async (c) => {
    const { data, error } = await c.client.rpc('share_set', { p_slug: slug, p_on: on });
    if (error) throw new Error(error.message);
    return (data as { share_token: string | null }).share_token;
  }, [`/s/${slug}`]);
}

// ------------------------------------------------------------------ search

export async function searchEverything(q: string): Promise<Hit[]> {
  if (!q.trim()) return [];
  const c = await me();
  const [all, board, open] = await Promise.all([slates.list(c), getBoard(c).catch(() => null), reminders.list(c).catch(() => [])]);
  return searchAll(q.slice(0, 100), all, notesOf(board), open);
}

// ------------------------------------------------------------------ inbox

export async function captureToInbox(form: FormData) {
  return run(async (c) => {
    const text = String(form.get('text') ?? '').trim();
    const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && (f as File).size > 0);
    const { data } = await c.client.auth.getUser();
    const refs = files.length ? await uploadFiles(c.client, data.user!.id, files) : [];
    return inbox.capture(c, { text: text || refs[0]?.name || '', files: refs, source: 'Added in Slates' });
  }, ['/inbox', '/home']);
}

export async function fileInbox(id: string, to: { slug?: string; note?: boolean }) {
  return run((c) => inbox.file(c, id, to), ['/inbox', '/home', '/notes', ...(to.slug ? [`/s/${to.slug}`] : [])]);
}

export async function dismissInbox(id: string) {
  return run((c) => slates.patchItems(c, INBOX_SLUG, { remove: [id], note: 'Dismissed an inbox item' }), ['/inbox', '/home']);
}

// ------------------------------------------------------------------ templates

export async function createFromTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return { ok: false, error: 'Unknown template' } as const;
  const res = await run((c) => slates.create(c, { title: t.title, kind: t.kind, data: t.data, icon: t.icon, category: t.category, note: `Created from the ${t.title} template` }), ['/home', '/boards']);
  if (res.ok && res.data) redirect(`/s/${(res.data as Slate).slug}?template=${t.id}`);
  return res;
}

// ------------------------------------------------------------------ automations

export async function saveAutomation(input: {
  id?: string;
  kind: AutomationKind;
  title: string;
  every: 'hourly' | 'daily' | 'weekly';
  at_hour?: number | null;
  at_weekday?: number | null;
  config?: Record<string, unknown>;
  enabled?: boolean;
}) {
  const prep = prepareAutomation(input.kind, input.config ?? {});
  if (!prep.ok) return prep;
  const config = prep.config;
  return run(async (c) => {
    // Editing a feed: keep writing to the same board, even if its source or filters change.
    if (input.id && input.kind === 'rss' && !config.slug) {
      const old = (await listAutomations(c.client)).find((a) => a.id === input.id);
      if (old) config.slug = feedSlug(old.config);
    }
    await ensureAssistant(c.client);
    return automationsRpc(c.client, 'save', { ...input, title: input.title.slice(0, 80), config });
  }, ['/settings/automations']);
}

/** Run one automation right now and report what happened (not "within 15 minutes"). */
export async function runAutomationNow(id: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const marked = await run((c) => automationsRpc(c.client, 'run_now', { id }));
  if (!marked.ok) return marked;
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: true, message: 'Queued. It runs within 15 minutes.' };
  try {
    const results = await runDueAutomations(supabaseAnon(), secret);
    for (const p of ['/settings/automations', '/home', '/inbox', '/notes']) revalidatePath(p);
    revalidatePath('/s/[slug]', 'page');
    const mine = results.find((r) => r.id === id);
    if (!mine) return { ok: true, message: 'Already running. Check back in a moment.' };
    if (mine.status === 'error') return { ok: false, error: mine.error ?? 'It failed' };
    if (mine.status === 'skipped') return { ok: true, message: 'Ran: nothing to do right now.' };
    return { ok: true, message: mine.pushed ? `Done: ${mine.pushed}` : 'Done.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteAutomation(id: string) {
  return run((c) => automationsRpc(c.client, 'delete', { id }), ['/settings/automations']);
}


// ------------------------------------------------------------------ files

export async function signFiles(paths: string[]): Promise<Record<string, string>> {
  const { signedUrls } = await import('@/lib/files');
  const c = await me();
  return signedUrls(c.client, paths.filter((p) => typeof p === 'string').slice(0, 50));
}

// ------------------------------------------------------------------ undo

/** Take back the last change to a board (or to Notes), or bring an archived board back. */
export async function undoChange(what: { type: 'version'; slug: string } | { type: 'unarchive'; slug: string }) {
  if (what.type === 'unarchive') return run((c) => slates.restore(c, what.slug), ['/home', '/spaces', '/boards', `/s/${what.slug}`]);
  return run(async (c) => {
    const versions = await history.versions(c, what.slug, 5);
    const current = versions.find((v) => v.current) ?? versions[0];
    const previous = versions.filter((v) => current && v.version < current.version).sort((a, b) => b.version - a.version)[0];
    if (!current || !previous) throw new Error('Nothing to undo');
    return history.restore(c, what.slug, previous.version);
  }, ['/home', '/notes', '/spaces', `/s/${what.slug}`]);
}
