import { supabaseServer } from '@/lib/supabase/server';
import { ProfileView } from '@/components/views/profile';
import { profileOf } from '@/lib/profile';

export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const client = await supabaseServer();
  const [{ data: auth }, { data: membership }, { data: isAdmin }] = await Promise.all([client.auth.getUser(), client.rpc('my_membership'), client.rpc('is_admin')]);
  return (
    <ProfileView
      profile={profileOf(auth.user)}
      email={auth.user?.email}
      provider={auth.user?.app_metadata?.provider}
      membership={membership ?? undefined}
      admin={!!isAdmin}
    />
  );
}
