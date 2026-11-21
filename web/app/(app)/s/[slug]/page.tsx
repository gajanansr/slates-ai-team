import { notFound, redirect } from 'next/navigation';
import { NOTES_SLUG, type DashboardDataT } from '@/lib/kinds';
import { getBoard, notesOf } from '@/lib/notes';
import { supabaseServer } from '@/lib/supabase/server';
import { slates as svc, SlatesError } from '@/lib/slates';
import { SlateDetailView } from '@/components/views/slate-detail';
import { history, metricTrends } from '@/lib/history';
import { TEMPLATES } from '@/lib/templates';
import { MarkOpened } from '@/components/opened';
import type { Slate } from '@/lib/kinds';
import { parseLayout, resolvePins } from '@/lib/app-layout';
import { desk, DESK_SLUG, toldAbout } from '@/lib/desk';

/** Fill in sparklines from history for metric tiles that don't send their own trend. */
function withTrends(slate: Slate, trends: Record<string, number[]>): Slate {
  const fill = (items: any[], prefix = '') => items.map((m) => (m.trend || !trends[prefix + m.id] ? m : { ...m, trend: trends[prefix + m.id] }));
  const d = slate.data as any;
  if (slate.kind === 'metrics') return { ...slate, data: { ...d, items: fill(d.items ?? []) } };
  if (slate.kind === 'dashboard')
    return { ...slate, data: { ...d, widgets: (d.widgets ?? []).map((w: any) => (w.kind === 'metrics' ? { ...w, data: { ...w.data, items: fill(w.data?.items ?? [], `${w.id}/`) } } : w)) } };
  return slate;
}

async function load(slug: string) {
  try {
    return await svc.get({ client: await supabaseServer(), token: null }, slug);
  } catch (e) {
    if (e instanceof SlatesError && (e.status === 404 || e.status === 422)) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return { title: (await svc.get({ client: await supabaseServer(), token: null }, slug)).title };
  } catch {
    return { title: 'Slate' };
  }
}

export default async function SlatePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ template?: string }> }) {
  const { slug } = await params;
  const { template } = await searchParams;
  if (slug === NOTES_SLUG) redirect('/notes');
  if (slug === DESK_SLUG) redirect('/home');
  const caller = { client: await supabaseServer(), token: null };
  const [loaded, all, onDesk, { data: settings }] = await Promise.all([load(slug), svc.list(caller), desk.list(caller).catch(() => []), caller.client.from('user_settings').select('app_layout').maybeSingle()]);
  const shortcut = resolvePins(parseLayout(settings?.app_layout), all.map((b) => ({ slug: b.slug, title: b.title, icon: b.icon ?? null, kind: b.kind as string, pinned: b.pinned && !b.hidden })), []).some((p) => p.key === `b:${slug}`);
  const hasMetrics = loaded.kind === 'metrics' || (loaded.kind === 'dashboard' && ((loaded.data as DashboardDataT).widgets ?? []).some((w) => w.kind === 'metrics'));
  const slate = hasMetrics ? withTrends(loaded, metricTrends(await history.series(caller, slug, 40).catch(() => []))) : loaded;
  const prompt = TEMPLATES.find((t) => t.id === template)?.prompt;
  const categories = [...new Set(all.map((s) => s.category).filter((c): c is string => Boolean(c)))].sort();
  const linksNotes = slate.kind === 'dashboard' && ((slate.data as DashboardDataT).widgets ?? []).some((w) => w.kind === 'note');
  const notes = linksNotes ? notesOf(await getBoard(caller)) : undefined;
  return (
    <>
      <MarkOpened keys={[`b-${slug}`]} />
      <SlateDetailView slate={slate} categories={categories} notes={notes} templatePrompt={prompt} shortcut={slug === 'inbox' || loaded.kind === 'brief' ? undefined : shortcut} told={slug === 'inbox' || slate.kind === 'brief' ? undefined : toldAbout(onDesk, 'slate', slug)} />
    </>
  );
}
