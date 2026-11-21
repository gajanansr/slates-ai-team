import { createHash } from 'node:crypto';
import { supabaseAnon } from '@/lib/supabase/server';
import { json, preflight, readJson } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';

/** Agent-led pairing, step 1. No auth: the agent asks for a code, the owner approves it at /pair. */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  let body: any = {};
  try {
    body = (await readJson(req)) ?? {};
  } catch {
    return json({ error: { code: 'bad_request', message: 'Body must be JSON: {"name": "My agent"}' } }, 400);
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = ip ? createHash('sha256').update(`${process.env.CRON_SECRET ?? 'slates'}:${day}:${ip}`).digest('hex').slice(0, 32) : null;

  const { data, error } = await supabaseAnon().rpc('pair_start', {
    p_name: typeof body.name === 'string' ? body.name : 'Agent',
    p_kind: typeof body.kind === 'string' ? body.kind : 'other',
    p_ip_hash: ipHash,
  });
  if (error) {
    const limited = error.code === 'P0429';
    return json({ error: { code: limited ? 'rate_limited' : 'server_error', message: error.message } }, limited ? 429 : 500);
  }
  const d = data as { device_secret: string; user_code: string; expires_in: number; interval: number };
  return json({
    data: {
      user_code: d.user_code,
      verification_url: `${origin}/pair`,
      verification_url_complete: `${origin}/pair?code=${d.user_code}`,
      device_secret: d.device_secret,
      expires_in: d.expires_in,
      interval: d.interval,
      next: `Tell the user: open ${origin}/pair?code=${d.user_code} (code ${d.user_code}) and press Allow. Meanwhile POST ${origin}/api/v1/pair/poll every ${d.interval}s with {"device_secret": "<device_secret>"} until status is "approved".`,
    },
  });
}
export const OPTIONS = preflight;
