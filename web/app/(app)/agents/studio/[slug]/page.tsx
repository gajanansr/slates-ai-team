import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { reminders } from '@/lib/reminders';
import { listAutomations } from '@/lib/automations';
import { summarize } from '@/lib/summary';
import { getAgent } from '@/lib/studio/build';
import { nextRun } from '@/lib/studio/blueprint';
import { AgentHome } from '@/components/studio/agent-home';
import { agentIntro } from '@/lib/studio/intro';
import { profileOf } from '@/lib/profile';
import { voiceLabel, voiceOf, voiceOptions } from '@/lib/voices';

export const metadata = { title: 'Agent' };

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await supabaseServer();
  const caller = { client, token: null };
  const m = await getAgent(caller, decodeURIComponent(slug)).catch(() => null);
  if (!m) notFound();
  const [all, ctx, autos, open, me] = await Promise.all([
    slates.list(caller).catch(() => []),
    reminders.context(caller).catch(() => ({ now: new Date().toISOString(), timezone: 'Asia/Kolkata' })),
    m.routines.some((r) => r.automation_id) ? listAutomations(client).catch(() => []) : Promise.resolve([]),
    reminders.list(caller).catch(() => []),
    client.auth.getUser().then((r) => r.data.user),
  ]);
  const tz = ctx.timezone;
  const bySlug = new Map(all.map((s) => [s.slug, s]));
  const boards = m.boards.flatMap((b) => {
    const s = bySlug.get(b.slug);
    if (!s || s.archived_at) return [];
    const { stat, label } = summarize(s);
    return [{ slug: s.slug, title: s.title, kind: s.kind, icon: s.icon, purpose: b.purpose, glance: [stat, label].filter(Boolean).join(' ') }];
  });
  const routines = m.routines.map((r) => {
    const auto = r.automation_id ? autos.find((a) => a.id === r.automation_id) : undefined;
    return { ...r, next: auto ? (auto.enabled ? auto.next_run_at : null) : nextRun(r.schedule, tz).toISOString(), paused: auto ? !auto.enabled : false };
  });
  const texts = new Set(m.reminders.map((r) => r.text.toLowerCase()));
  const mine = open.filter((r) => texts.has(r.text.toLowerCase())).map((r) => ({ id: r.id, text: r.text, due_at: r.due_at }));
  // Its Murf voice, and the intro clip if one is stored already (made on first play otherwise).
  const voice = voiceOf(m.voice, tz);
  const intro = me ? await agentIntro({ sb: client, userId: me.id }, m, profileOf(me).name, { timezone: tz }).catch(() => null) : null;
  const sound = {
    voice: { id: voice.id, label: voiceLabel(voice) },
    options: voiceOptions(voice.id).map((v) => ({ id: v.id, label: voiceLabel(v) })),
    intro: intro?.url ? { url: intro.url, text: intro.text } : null,
  };
  return <AgentHome m={m} boards={boards} routines={routines} mine={mine} tz={tz} sound={sound} />;
}
