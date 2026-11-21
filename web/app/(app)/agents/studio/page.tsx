import { supabaseServer } from '@/lib/supabase/server';
import { PageHeader } from '@/components/page-header';
import { StudioView } from '@/components/studio/studio-view';
import { listAgents } from '@/lib/studio/build';
import { buildsInLastDay, DAILY_BUILDS } from '@/lib/studio/limits';
import { studioReady } from '@/lib/studio/generate';

export const metadata = { title: 'Agent Studio' };

/** Agent Studio: describe a job, get a working agent for it. Lists the agents you have built. */
export default async function StudioPage() {
  const caller = { client: await supabaseServer(), token: null };
  const [agents, used] = await Promise.all([listAgents(caller).catch(() => []), buildsInLastDay(caller).catch(() => 0)]);
  return (
    <>
      <PageHeader back={{ href: '/agents', label: 'Back to Agents' }} kicker="Agent Studio" title="New agent" />
      <StudioView
        ready={studioReady()}
        left={Math.max(0, DAILY_BUILDS - used)}
        agents={agents.map(({ manifest: m }) => ({ slug: m.slug, name: m.name, icon: m.icon, color: m.color, mission: m.mission, boards: m.boards.length, routines: m.routines.length }))}
      />
    </>
  );
}
