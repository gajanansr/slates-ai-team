import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { CallScreen } from '@/components/call/call-screen';
import { callConfig } from '@/lib/call';
import { supabaseServer } from '@/lib/supabase/server';
import { getAgent } from '@/lib/studio/build';
const agentPath = (slug: string) => `/agents/studio/${encodeURIComponent(slug)}`;

export const metadata = { title: 'Call Slates' };

/** /call, /call?mode=standup to put the standup first, or /call?agent=<slug> to talk to one of your agents. */
export default async function CallPage({ searchParams }: { searchParams: Promise<{ mode?: string; agent?: string }> }) {
  const { mode, agent: slug } = await searchParams;
  if (slug) {
    const m = await getAgent({ client: await supabaseServer(), token: null }, slug).catch(() => null);
    if (!m) notFound();
    const agent = { slug: m.slug, name: m.name, icon: m.icon, color: m.color };
    return (
      <div>
        <PageHeader title={`Call ${m.name}`} back={{ href: agentPath(m.slug), label: `Back to ${m.name}` }} />
        <CallScreen ready={callConfig() !== null} initialMode="call" agent={agent} />
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Call Slates" back={{ href: '/ask', label: 'Back to Ask' }} />
      <CallScreen ready={callConfig() !== null} initialMode={mode === 'standup' ? 'standup' : 'call'} />
    </div>
  );
}
