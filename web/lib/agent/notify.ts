import 'server-only';
import { sendPush, type PushPayload } from '@/lib/push';
import { SlatesError, type Caller } from '@/lib/slates';

const STATUS: Record<string, number> = { P0401: 401, P0403: 403, P0429: 429 };

/** Ask the DB (scope, prefs, rate limit, logging) and push to the owner's devices. */
export async function agentNotify(caller: Caller, kind: 'agent' | 'brief', payload: PushPayload) {
  if (!caller.token) throw new SlatesError('notify is for agents; it needs an agent token', 403, 'forbidden');
  const { data, error } = await caller.client.rpc('push_targets', { p_token: caller.token, p_kind: kind, p_summary: payload.title });
  if (error) throw new SlatesError(error.message, STATUS[error.code ?? ''] ?? 500, error.code === 'P0429' ? 'rate_limited' : 'error');
  const res = data as { sent: boolean; reason?: string; subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[] };
  if (!res.sent) return { delivered: 0, devices: 0, skipped: res.reason ?? 'disabled' };
  if (res.subscriptions.length === 0) return { delivered: 0, devices: 0, skipped: 'no devices have notifications enabled' };
  const r = await sendPush(res.subscriptions, payload, async (endpoint) => {
    await caller.client.rpc('push_prune', { p_endpoint: endpoint, p_token: caller.token });
  });
  return { delivered: r.sent, devices: res.subscriptions.length };
}
