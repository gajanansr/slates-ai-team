import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { AdminDashboard, type AdminUser } from '@/components/admin/admin-dashboard';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (!isAdmin) notFound();
  const { d, tab: t } = await searchParams;
  const tab = t === 'people' || t === 'waitlist' ? t : 'overview';
  const days = [7, 30, 90].includes(Number(d)) ? Number(d) : 30;
  // Only what the open tab needs: the analytics query is the slow one.
  if (tab === 'overview') {
    const [{ data: stats, error }, { data: waitlist }] = await Promise.all([sb.rpc('admin_stats', { p_days: days }), sb.rpc('admin_waitlist')]);
    if (error || !stats) throw new Error('Could not load admin stats');
    return <AdminDashboard days={days} stats={stats} waitlist={waitlist ?? []} tab={tab} />;
  }
  if (tab === 'people') {
    const [{ data: users }, { data: codes }, { data: waitlist }] = await Promise.all([sb.rpc('admin_users'), sb.rpc('admin_codes'), sb.rpc('admin_waitlist')]);
    return <AdminDashboard days={days} users={(users ?? []) as AdminUser[]} codes={codes ?? []} waitlist={waitlist ?? []} tab={tab} />;
  }
  const { data: waitlist } = await sb.rpc('admin_waitlist');
  return <AdminDashboard days={days} waitlist={waitlist ?? []} tab={tab} />;
}
