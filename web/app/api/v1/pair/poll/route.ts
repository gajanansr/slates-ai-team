import { supabaseAnon } from '@/lib/supabase/server';
import { json, preflight, readJson } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';

/** Agent-led pairing, step 2: poll until approved. The token is returned exactly once. */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  let body: any = {};
  try {
    body = (await readJson(req)) ?? {};
  } catch {
    return json({ error: { code: 'bad_request', message: 'Body must be JSON: {"device_secret": "slp_..."}' } }, 400);
  }
  const secret = typeof body.device_secret === 'string' ? body.device_secret : '';
  if (!/^slp_[0-9a-f]{64}$/.test(secret)) {
    return json({ error: { code: 'bad_request', message: 'device_secret is required (from POST /api/v1/pair).' } }, 400);
  }
  const { data, error } = await supabaseAnon().rpc('pair_poll', { p_device_secret: secret });
  if (error) return json({ error: { code: 'server_error', message: error.message } }, 500);
  const r = data as { status: string; token?: string; agent_name?: string; scopes?: string[]; message?: string };
  const messages: Record<string, string> = {
    pending: 'Waiting for the user to press Allow. Poll again in 3 seconds.',
    denied: 'The user said no. Stop and tell them.',
    expired: 'The code expired. Start again with POST /api/v1/pair.',
    claimed: 'This token was already delivered once. Start again if you lost it.',
    invalid: 'Unknown device_secret.',
  };
  if (r.status === 'approved') {
    return json({
      data: {
        status: 'approved',
        token: r.token,
        agent_name: r.agent_name,
        scopes: r.scopes,
        mcp_url: `${origin}/mcp`,
        rest_base: `${origin}/api/v1/tools/`,
        next: 'Save this token somewhere safe (it is shown once) and send it as "Authorization: Bearer <token>". Then call list_slates.',
      },
    });
  }
  return json({ data: { status: r.status, message: r.message ?? messages[r.status] ?? '' } });
}
export const OPTIONS = preflight;
