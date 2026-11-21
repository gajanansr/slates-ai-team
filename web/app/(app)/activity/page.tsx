import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { PageHeader } from '@/components/page-header';
import { ActivityFeed } from '@/components/activity-feed';

export const metadata = { title: 'Activity' };

export default async function ActivityPage() {
  const caller = { client: await supabaseServer(), token: null };
  const [items, all] = await Promise.all([slates.activity(caller, 150), slates.list(caller, { include_archived: true })]);
  // Show board names, not their internal ids.
  const titles = Object.fromEntries(all.map((s) => [s.slug, s.title]));
  return (
    <>
      <PageHeader back={{ href: '/settings', label: 'Back to settings' }} kicker="Live" title="Activity" sub="Everything you and your agents changed." />
      <div className="rise-2">
        <ActivityFeed items={items} titles={titles} />
      </div>
    </>
  );
}
