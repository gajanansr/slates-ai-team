import { agentRoute } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export const POST = agentRoute(({ body }) => ({ tool: 'reorder_slates', args: body }));
export const OPTIONS = preflight;
