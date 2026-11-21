import { supabaseServer } from '@/lib/supabase/server';
import { AgentsView, type AgentRow } from '@/components/views/agents';
import { slates } from '@/lib/slates';
import { desk } from '@/lib/desk';
import { getBoard, notesOf } from '@/lib/notes';

export const metadata = { title: 'Agents' };

export default async function AgentsPage() {
  const sb = await supabaseServer();
  const caller = { client: sb, token: null };
  const [{ data }, all, activity, onDesk, board] = await Promise.all([
    sb
      .from('agents')
      .select('id, name, kind, scopes, token_prefix, last_used_at, revoked_at, created_at, client_id, expires_at, boards')
      .neq('kind', 'slates')
      .order('created_at', { ascending: false }),
    slates.list(caller),
    slates.activity(caller, 200).catch(() => []),
    desk.list(caller).catch(() => []),
    getBoard(caller).catch(() => null),
  ]);
  // Report card: what each agent changed in the last 7 days, and how its last session ended.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const report: Record<string, { changes: number; session?: { did: string; open?: string; at?: string } }> = {};
  for (const a of activity) {
    if (!a.agent_name || new Date(a.created_at).getTime() < weekAgo) continue;
    (report[a.agent_name] ??= { changes: 0 }).changes++;
  }
  for (const d of onDesk) if (d.type === 'session' && !(report[d.from] ??= { changes: 0 }).session) report[d.from].session = { did: d.text, open: d.context, at: d.at };
  const handoffs = onDesk.filter((d) => d.type === 'handoff' && d.open).map((d) => ({ id: d.id, from: d.from, to: d.to ?? 'any agent', task: d.text }));
  const playbooks = notesOf(board).filter((n) => (n.tags ?? []).some((t) => t.toLowerCase() === 'playbook')).map((n) => ({ id: n.id, title: n.title }));
  return <AgentsView agents={(data ?? []) as AgentRow[]} boards={all.map((s) => ({ slug: s.slug, title: s.title }))} report={report} handoffs={handoffs} playbooks={playbooks} />;
}
