import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { SettingsView } from '@/components/views/settings';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const client = await supabaseServer();
  const [{ data: auth }, all, { data: prefs }, { count: agentCount }] = await Promise.all([
    client.auth.getUser(),
    slates.list({ client, token: null }, { include_archived: true }),
    client.from('notification_prefs').select('on_agent, on_brief, on_digest').maybeSingle(),
    client.from('agents').select('id', { count: 'exact', head: true }).is('revoked_at', null).neq('kind', 'slates').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
  ]);
  return <SettingsView email={auth.user?.email} all={all} prefs={prefs ?? undefined} agentCount={agentCount ?? 0} />;
}
