import 'server-only';
import { z } from 'zod';
import { supabaseAnon } from '@/lib/supabase/server';
import { slates, SlatesError, toSlatesError, type Caller } from '@/lib/slates';
import { TOOL_BY_NAME } from '@/lib/agent/tools';

export const TOKEN_RE = /^slt_[0-9a-f]{64}$/;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
};

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Resolve the agent behind the request, or throw 401. */
export async function agentCaller(req: Request): Promise<Caller & { agentName: string | null; scopes: string[] }> {
  const token = bearer(req);
  if (!token || !TOKEN_RE.test(token)) {
    throw new SlatesError('Missing or malformed agent token. Send "Authorization: Bearer slt_…" (create one in Slates → Agents).', 401, 'unauthorized');
  }
  const caller: Caller = { client: supabaseAnon(), token };
  const me = await slates.whoami(caller);
  return { ...caller, agentName: me.agent_name, scopes: me.scopes };
}

export async function runTool(caller: Caller, name: string, rawArgs: unknown) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new SlatesError(`Unknown tool "${name}"`, 404, 'not_found');
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw new SlatesError(`Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`, 422, 'invalid');
  }
  return tool.run(caller, parsed.data);
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extra },
  });
}

export function errorResponse(e: unknown, origin?: string) {
  const err = toSlatesError(e);
  if (err.status === 500) console.error('[slates api]', e);
  const extra: Record<string, string> = {};
  if (err.status === 401) {
    const meta = origin ? `, resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` : '';
    extra['WWW-Authenticate'] = `Bearer realm="slates"${meta}, error="invalid_token"`;
  }
  return json({ error: { code: err.code, message: err.message } }, err.status, extra);
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  if (text.length > 1_000_000) throw new SlatesError('Request body too large', 413, 'too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new SlatesError('Body must be valid JSON', 400, 'bad_request');
  }
}
