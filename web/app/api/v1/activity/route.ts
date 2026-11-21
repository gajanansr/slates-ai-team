import { agentRoute, query } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export const GET = agentRoute(({ req }) => {
  const limit = Number(query(req).limit);
  return { tool: 'recent_activity', args: Number.isFinite(limit) && limit > 0 ? { limit } : {} };
});
export const POST = agentRoute(({ body }) => ({ tool: 'log_activity', args: body }), { status: 201 });
export const OPTIONS = preflight;
