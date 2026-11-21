import { supabaseServer } from '@/lib/supabase/server';
import { slates as svc } from '@/lib/slates';
import { reminders, todaysReminders } from '@/lib/reminders';
import { TodayView } from '@/components/views/today';
import { profileOf } from '@/lib/profile';
import { history } from '@/lib/history';
import { listAutomations } from '@/lib/automations';
import { desk, needsUser } from '@/lib/desk';

export const metadata = { title: 'Today' };

export default async function Home() {
  const client = await supabaseServer();
  const caller = { client, token: null };
  const [all, activity, { data }, open, { data: settings }, changes, autos, { count: agentCount }, onDesk] = await Promise.all([
    svc.list(caller),
    svc.activity(caller, 3),
    client.auth.getUser(),
    reminders.list(caller),
    client.from('user_settings').select('timezone, app_layout').maybeSingle(),
    history.changes(caller).catch(() => undefined),
    listAutomations(client).catch(() => []),
    client.from('agents').select('id', { count: 'exact', head: true }).is('revoked_at', null).neq('kind', 'slates'),
    desk.list(caller).catch(() => []),
  ]);
  const inboxCount = ((all.find((s) => s.slug === 'inbox')?.data as { items?: unknown[] } | undefined)?.items ?? []).length;
  const tz = settings?.timezone ?? 'Asia/Kolkata';
  return (
    <TodayView
      all={all}
      activity={activity}
      profile={profileOf(data.user)}
      todays={todaysReminders(open, tz)}
      open={open}
      tz={tz}
      inboxCount={inboxCount}
      changes={changes}
      autos={autos.map((a) => ({ id: a.id, title: a.title, kind: a.kind, last_run_at: a.last_run_at, last_status: a.last_status ?? null }))}
      hasAgent={(agentCount ?? 0) > 0}
      desk={needsUser(onDesk)}
    />
  );
}
