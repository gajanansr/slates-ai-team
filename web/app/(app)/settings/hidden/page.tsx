import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { PageHeader } from '@/components/page-header';
import { HiddenBoards } from '@/components/hidden-boards';

export const metadata = { title: 'Hidden & archived' };

export default async function HiddenPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const client = await supabaseServer();
  const all = await slates.list({ client, token: null }, { include_archived: true });
  const { tab } = await searchParams;
  const pick = (s: (typeof all)[number]) => ({ slug: s.slug, title: s.title, kind: s.kind, icon: s.icon ?? null, at: s.archived_at ?? s.updated_at ?? null });
  return (
    <>
      <PageHeader back={{ href: '/settings', label: 'Back to settings' }} title="Hidden & archived" sub="Hidden boards stay out of Home and Boards. Archived boards are put away; restore any time." />
      <HiddenBoards
        tab={tab === 'archived' ? 'archived' : 'hidden'}
        hidden={all.filter((s) => !s.archived_at && s.hidden).map(pick)}
        archived={all.filter((s) => s.archived_at).map(pick)}
      />
    </>
  );
}
