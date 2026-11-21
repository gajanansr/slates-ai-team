import { agentRoute, query } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export const GET = agentRoute(({ req }) => ({
  tool: 'list_slates',
  args: { include_archived: query(req).include_archived === 'true' },
}));
export const POST = agentRoute(({ body }) => ({ tool: 'create_slate', args: body }), { status: 201 });
export const OPTIONS = preflight;
