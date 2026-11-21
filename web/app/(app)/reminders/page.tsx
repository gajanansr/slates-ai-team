import { supabaseServer } from '@/lib/supabase/server';
import { dayKey, reminders } from '@/lib/reminders';
import { slates } from '@/lib/slates';
import { agenda } from '@/lib/agenda';
import { RemindersView } from '@/components/views/reminders';

export const metadata = { title: 'Reminders' };

export default async function RemindersPage() {
  const client = await supabaseServer();
  const [list, { data: settings }, all] = await Promise.all([
    reminders.list({ client, token: null }),
    client.from('user_settings').select('timezone').maybeSingle(),
    slates.list({ client, token: null }),
  ]);
  const tz = settings?.timezone ?? 'Asia/Kolkata';
  return <RemindersView list={list} tz={tz} week={agenda(all, list, tz)} today={dayKey(new Date(), tz)} />;
}
