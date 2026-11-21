import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { slates, SlatesError, type Caller } from '@/lib/slates';
import { decrypt, encrypt } from '@/lib/crypto';
import { assistantReady, runAssistant } from '@/lib/assistant';
import { jevReady } from '@/lib/jev';
import { encryptionReady } from '@/lib/crypto';
import { FEED_SOURCES } from '@/lib/feed-sources';
import { fileInboxWithJev, snapshot } from '@/lib/ask-router';
import { readSource } from '@/lib/rss';
import { inbox } from '@/lib/inbox';
import type { SlateKind } from '@/lib/kinds';

export type AutomationKind = 'brief' | 'recap' | 'inbox' | 'rss';
export type Automation = {
  id: string;
  kind: AutomationKind;
  title: string;
  config: Record<string, any>;
  every: 'hourly' | 'daily' | 'weekly';
  at_hour: number | null;
  at_weekday: number | null;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
};

export const NEEDS_AI: AutomationKind[] = ['brief', 'recap', 'inbox'];
export const AUTOMATION_KINDS: AutomationKind[] = ['brief', 'recap', 'inbox', 'rss'];

/**
 * Checks shared by the app and agents before saving an automation: the server is set up for
 * it, and a feed has a known source or a usable address ("theverge.com" works too).
 * Returns the cleaned config, or a message saying what's wrong.
 */
export function prepareAutomation(kind: AutomationKind, input: Record<string, unknown> = {}): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (!encryptionReady()) return { ok: false, error: 'Automations need one more server setting (SLATES_ENC_KEY).' };
  if (NEEDS_AI.includes(kind) && !assistantReady() && !(kind === 'inbox' && jevReady())) return { ok: false, error: 'This needs Ask Slates, which is not set up yet.' };
  const config = { ...input };
  if (kind === 'rss') {
    let u = String(config.url ?? '').trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    u = u.replace(/^http:\/\//i, 'https://');
    if (u) config.url = u;
    const known = FEED_SOURCES.some((f) => f.id === config.source);
    if (!known && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(u)) return { ok: false, error: 'Pick a source, or paste a website address like theverge.com' };
  }
  return { ok: true, config };
}

/** Session-only RPC wrapper. */
export async function automationsRpc<T>(client: SupabaseClient, op: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc('automations_exec', { p_op: op, p_args: args });
  if (error) throw new SlatesError(error.message, error.code === 'P0404' ? 404 : error.code === 'P0401' ? 401 : 422, 'invalid');
  return data as T;
}

/** Make sure the user has a built-in "Slates" agent whose token the server can reuse (encrypted). */
export async function ensureAssistant(client: SupabaseClient) {
  const existing = await automationsRpc<{ agent_id: string } | null>(client, 'assistant');
  if (existing?.agent_id) return;
  const { data, error } = await client.rpc('create_agent', { p_name: 'Slates', p_kind: 'slates', p_scopes: ['read', 'write'] });
  if (error) throw new SlatesError(error.message, 422, 'invalid');
  const { token, agent } = data as { token: string; agent: { id: string } };
  await automationsRpc(client, 'set_assistant', { agent_id: agent.id, token_enc: encrypt(token) });
}

// ------------------------------------------------------------------ worker

type Job = {
  id: string;
  owner_id: string;
  kind: AutomationKind;
  title: string;
  config: Record<string, any>;
  timezone: string;
  last_run_at: string | null;
  token_enc: string | null;
  subscriptions: any[];
};

const slugFor = (prefix: string, s: string) => `${prefix}-${createHash('sha256').update(s).digest('hex').slice(0, 8)}`;

/** The board a feed automation writes to (stable even when its source or filters change). */
export const feedSlug = (config: Record<string, any>) => config.slug ?? slugFor('feed', String(config.url ?? config.source ?? ''));

/** Replace a board's data, creating it on first run. */
async function upsertBoard(c: Caller, slug: string, title: string, kind: SlateKind, data: Record<string, unknown>, note: string, icon?: string) {
  try {
    await slates.get(c, slug);
    return await slates.update(c, slug, { data, note });
  } catch (e) {
    if (!(e instanceof SlatesError && e.status === 404)) throw e;
    return slates.create(c, { slug, title, kind, data, note, icon: icon as any });
  }
}

const localNow = (tz: string) => new Date().toLocaleString('en-IN', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });

type Push = { title: string; body?: string; url: string };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Run one automation. Every kind reports a push when it did something (unless notify is off). */
export async function runJob(job: Job, client: SupabaseClient): Promise<{ status: 'ok' | 'skipped'; push?: Push }> {
  const r = await runJobInner(job, client);
  return job.config?.notify === false ? { status: r.status } : r;
}

async function runJobInner(job: Job, client: SupabaseClient): Promise<{ status: 'ok' | 'skipped'; push?: Push }> {
  if (!job.token_enc) throw new Error('The built-in Slates agent was revoked. Turn the automation off and on again.');
  const c: Caller = { client, token: decrypt(job.token_enc) };

  switch (job.kind) {
    case 'brief': {
      const all = await slates.list(c);
      await runAssistant(
        c,
        [{ role: 'user', content: `It is ${localNow(job.timezone)} (${job.timezone}). Build today's brief.` }],
        undefined,
        {
          extraSystem:
            `You are running unattended as the morning brief. Look at reminders due today, trackers with due dates, countdowns within a week, and anything agents changed recently. Then call set_today_brief once with a date, a one-line headline and 3-8 concrete priorities (tone "bad" for urgent, "warn" for important). Do not ask questions.\n\n${snapshot(all, null, localNow(job.timezone), job.timezone)}`,
          maxSteps: 6,
          toolNames: ['list_reminders', 'get_slate', 'what_changed', 'set_today_brief'],
        },
      );
      return { status: 'ok', push: { title: "Today's brief is ready", body: job.title, url: '/home' } };
    }
    case 'recap': {
      const all = await slates.list(c);
      await runAssistant(
        c,
        [{ role: 'user', content: `It is ${localNow(job.timezone)}. Write my weekly recap.` }],
        undefined,
        {
          extraSystem:
            `You are running unattended as the weekly recap. Use recent_activity, what_changed (since 7 days ago), list_reminders and the boards to summarise the week: what got done, what moved in numbers, what slipped, and the top 3 things for next week. Save it with add_note (title "Week of <date>", tags ["recap"]). Do not ask questions.\n\n${snapshot(all, null, localNow(job.timezone), job.timezone)}`,
          maxSteps: 6,
          toolNames: ['recent_activity', 'what_changed', 'list_reminders', 'get_slate', 'add_note'],
        },
      );
      return { status: 'ok', push: { title: 'Your week in Slates', body: 'Your weekly recap is in Notes.', url: '/notes' } };
    }
    case 'inbox': {
      const items = await inbox.list(c);
      if (!items.length) return { status: 'skipped' };
      const viaJev = await fileInboxWithJev(c, await slates.list(c));
      if (!viaJev) {
        await runAssistant(c, [{ role: 'user', content: 'File my inbox.' }], undefined, {
          extraSystem:
            'You are running unattended to tidy the Inbox. For each item from list_inbox, pick the best existing board from list_slates (or Notes for longer text) and call file_inbox_item. Leave an item in the Inbox if nothing fits. Never create boards. Do not ask questions.',
          maxSteps: 14,
        });
      }
      const left = (await inbox.list(c).catch(() => items)).length;
      const filed = items.length - left;
      if (filed <= 0) return { status: 'skipped' };
      return { status: 'ok', push: { title: `Filed ${plural(filed, 'Inbox item')}`, body: left ? `${left} left to sort.` : 'Inbox is clear.', url: '/inbox' } };
    }
    case 'rss': {
      const feed = await readSource(job.config);
      const items = feed.map((f) => ({
        id: createHash('sha256').update(f.url).digest('hex').slice(0, 16),
        title: f.title,
        url: f.url,
        ...(f.date ? { detail: f.date.slice(0, 40) } : {}),
      }))
        // Feeds can list the same link twice (Hacker News does); ids come from the URL, so keep the first.
        .filter((it, i, all) => all.findIndex((x) => x.id === it.id) === i);
      const slug = feedSlug(job.config);
      const before = await slates.get(c, slug).catch(() => null);
      const seen = new Set((((before?.data as { items?: { id: string }[] } | undefined)?.items) ?? []).map((i) => i.id));
      const fresh = before ? items.filter((i) => !seen.has(i.id)) : [];
      await upsertBoard(c, slug, job.title, 'links', { items }, `Synced ${items.length} from the feed`, 'news');
      if (!fresh.length) return { status: before ? 'skipped' : 'ok' };
      return { status: 'ok', push: { title: `${job.title}: ${plural(fresh.length, 'new post')}`, body: fresh[0].title, url: `/s/${slug}` } };
    }

  }
}

export const listAutomations = (client: SupabaseClient) => automationsRpc<Automation[]>(client, 'list');

