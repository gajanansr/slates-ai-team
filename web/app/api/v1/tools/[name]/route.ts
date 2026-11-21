import { agentRoute } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
/** Generic tool call: POST /api/v1/tools/<name> with the tool arguments as the JSON body. */
export const POST = agentRoute<{ name: string }>(({ params, body }) => ({ tool: params.name, args: body }));
export const OPTIONS = preflight;
