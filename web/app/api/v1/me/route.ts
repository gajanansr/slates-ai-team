import { agentCaller, errorResponse, json, preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const c = await agentCaller(req);
    return json({ data: { agent: c.agentName, scopes: c.scopes } });
  } catch (e) {
    return errorResponse(e);
  }
}
export const OPTIONS = preflight;
