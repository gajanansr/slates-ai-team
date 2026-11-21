import { supabaseServer } from '@/lib/supabase/server';
import { listAutomations } from '@/lib/automations';
import { assistantReady } from '@/lib/assistant';
import { jevReady } from '@/lib/jev';
import { encryptionReady } from '@/lib/crypto';
import { PageHeader } from '@/components/page-header';
import { AutomationsView } from '@/components/automations/automations-view';
import { MarkOpened } from '@/components/opened';

export const metadata = { title: 'Automations' };
// "Run now" runs the automation inside this page's server action.
export const maxDuration = 120;

export default async function AutomationsPage() {
  const client = await supabaseServer();
  const items = await listAutomations(client).catch(() => []);
  return (
    <>
      <PageHeader back={{ href: '/settings', label: 'Back to settings' }} kicker="Setup" title="Automations" sub="Things Slates does on its own, on a schedule." />
      <MarkOpened keys={items.map((a) => `a-${a.id}`)} />
      <AutomationsView
        items={items}
        ready={{ ai: assistantReady(), jev: jevReady(), enc: encryptionReady() }}
      />
    </>
  );
}
