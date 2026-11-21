import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runJob } from '@/lib/automations';
import { sendPush } from '@/lib/push';

export type RunResult = { id: string; owner_id: string; status: 'ok' | 'skipped' | 'error'; error?: string; pushed?: string };

/**
 * Claim every due automation and run each as its owner's built-in Slates agent.
 * Used by the 15-minute cron and by "Run now" (so a tap runs straight away).
 */
export async function runDueAutomations(sb: SupabaseClient, secret: string, push = sendPush): Promise<RunResult[]> {
  const { data, error } = await sb.rpc('cron_due_automations', { p_secret: secret });
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as any[];
  const prune = async (endpoint: string) => {
    await sb.rpc('push_prune', { p_endpoint: endpoint, p_secret: secret });
  };
  return Promise.all(
    jobs.map(async (job): Promise<RunResult> => {
      try {
        const r = await runJob(job, sb);
        let pushed: string | undefined;
        if (r.push) {
          pushed = r.push.title;
          if (job.subscriptions?.length) await push(job.subscriptions, { ...r.push, tag: `auto-${job.kind}` }, prune).catch((e) => console.warn('[automations] push', e?.message));
        }
        await sb.rpc('cron_automation_done', { p_secret: secret, p_id: job.id, p_status: r.status, p_error: null });
        return { id: job.id, owner_id: job.owner_id, status: r.status, pushed };
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 500);
        console.error('[automations]', job.kind, msg);
        if (job.config?.notify !== false && job.subscriptions?.length) {
          await push(job.subscriptions, { title: `${job.title} didn't run`, body: msg.slice(0, 120), url: '/settings/automations', tag: `auto-${job.kind}` }, prune).catch(() => {});
        }
        await sb.rpc('cron_automation_done', { p_secret: secret, p_id: job.id, p_status: 'error', p_error: msg });
        return { id: job.id, owner_id: job.owner_id, status: 'error', error: msg };
      }
    }),
  );
}
