import { agentRoute } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export const PUT = agentRoute(({ body }) => ({ tool: 'set_today_brief', args: body }));
export const OPTIONS = preflight;
