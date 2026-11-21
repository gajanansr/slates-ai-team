import { agentCaller, CORS_HEADERS, errorResponse, json, preflight, readJson } from '@/lib/agent/http';
import { handleRpc } from '@/lib/agent/mcp';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  let caller;
  try {
    caller = await agentCaller(req);
  } catch (e) {
    return errorResponse(e, new URL(req.url).origin);
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as any[];
  const responses = (await Promise.all(messages.map((m) => handleRpc(caller, m)))).filter(Boolean);
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(batch ? responses : responses[0]);
}

// Stateless server: no server-initiated SSE stream and no sessions to delete.
export function GET() {
  return new Response('Slates MCP endpoint. POST JSON-RPC with "Authorization: Bearer slt_…".', {
    status: 405,
    headers: { Allow: 'POST, OPTIONS', ...CORS_HEADERS },
  });
}
export const DELETE = GET;
export const OPTIONS = preflight;
