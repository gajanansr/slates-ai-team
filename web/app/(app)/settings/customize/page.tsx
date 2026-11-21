import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { parseLayout } from '@/lib/app-layout';
import { CustomizeApp } from '@/components/settings/customize-app';

export const metadata = { title: 'Colour' };

export default async function CustomizePage() {
  const client = await supabaseServer();
  const [{ data: settings }, all, { data: isAdmin }] = await Promise.all([
    client.from('user_settings').select('app_layout').maybeSingle(),
    slates.list({ client, token: null }),
    client.rpc('is_admin'),
  ]);
  const boards = all.filter((b) => !['brief', 'notes'].includes(b.kind) && b.slug !== 'inbox').map((b) => ({ slug: b.slug, title: b.title, icon: b.icon ?? null, kind: b.kind as string }));
  return <CustomizeApp layout={parseLayout(settings?.app_layout)} boards={boards} admin={!!isAdmin} />;
}
