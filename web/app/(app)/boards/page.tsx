import { supabaseServer } from '@/lib/supabase/server';
import { slates as svc } from '@/lib/slates';
import { BoardsView } from '@/components/views/boards';
import { viewMode } from '@/lib/view-mode';

export const metadata = { title: 'Boards' };

export default async function BoardsPage({ searchParams }: { searchParams: Promise<{ c?: string; new?: string }> }) {
  const [{ c, new: isNew }, all, view] = await Promise.all([searchParams, svc.list({ client: await supabaseServer(), token: null }), viewMode('boards')]);
  return <BoardsView all={all} filter={c} openNew={isNew === '1'} view={view} />;
}
