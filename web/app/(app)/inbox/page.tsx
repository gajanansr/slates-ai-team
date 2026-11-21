import { supabaseServer } from '@/lib/supabase/server';
import { slates } from '@/lib/slates';
import { inbox, INBOX_SLUG } from '@/lib/inbox';
import { askReady } from '@/lib/assistant';
import { PageHeader } from '@/components/page-header';
import { InboxView } from '@/components/inbox/inbox-view';

export const metadata = { title: 'Inbox' };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ captured?: string; text?: string }> }) {
  const caller = { client: await supabaseServer(), token: null };
  const [items, all, { captured, text }] = await Promise.all([inbox.list(caller), slates.list(caller), searchParams]);
  const boards = all.filter((s) => s.slug !== INBOX_SLUG && s.kind !== 'notes').map((s) => ({ slug: s.slug, title: s.title, kind: s.kind }));
  return (
    <>
      <PageHeader back={{ href: '/home', label: 'Back to home' }} kicker="Capture" title="Inbox" sub={items.length ? `${items.length} to sort` : undefined} />
      <InboxView items={items} boards={boards} canAsk={askReady()} flash={captured} initialText={text?.slice(0, 2000)} />
    </>
  );
}
