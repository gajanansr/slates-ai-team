import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { freshDb, fakeClient, USER } from './helpers';

vi.mock('server-only', () => ({}));
// The feed is the only network call an RSS automation makes.
let feed: { title: string; url: string; date?: string }[] = [];
vi.mock('@/lib/rss', () => ({ readSource: async () => feed, fetchFeed: async () => feed, parseFeed: () => [] }));

beforeAll(() => {
  process.env.SLATES_ENC_KEY = randomBytes(32).toString('base64');
});

describe('automations end to end (Run now path)', () => {
  it('claims a due automation, runs it as the Slates agent, updates the board and prepares a push', async () => {
    const { ensureAssistant, automationsRpc } = await import('@/lib/automations');
    const { runDueAutomations } = await import('@/lib/automations-run');
    const { slates } = await import('@/lib/slates');

    const pg = await freshDb();
    await pg.exec(`insert into public.app_config values ('cron_secret_hash', encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
    const owner = fakeClient(pg, USER) as any;
    await owner.rpc('push_subscribe', { p_endpoint: 'https://push.example.com/a', p_p256dh: 'k', p_auth: 'a' });

    await ensureAssistant(owner);
    const saved = await automationsRpc<{ id: string }>(owner, 'save', { kind: 'rss', title: 'HN', every: 'daily', at_hour: 7, config: { url: 'https://x.com/feed', slug: 'hn' } });

    // Not due yet: nothing runs.
    const anon = fakeClient(pg, null) as any;
    const pushes: string[] = [];
    const push = (async (_t: unknown, p: { title: string }) => {
      pushes.push(p.title);
      return { sent: 1, failed: 0 };
    }) as any;
    expect(await runDueAutomations(anon, 's3cret', push)).toEqual([]);

    // First run creates the board.
    feed = [{ title: 'First post', url: 'https://x.com/1' }];
    await automationsRpc(owner, 'run_now', { id: saved.id });
    const first = await runDueAutomations(anon, 's3cret', push);
    expect(first).toMatchObject([{ id: saved.id, status: 'ok' }]);
    const board = await slates.get({ client: owner, token: null }, 'hn');
    expect((board.data as any).items.map((i: any) => i.title)).toEqual(['First post']);

    // Second run with a new post: notifies about it.
    feed = [{ title: 'Second post', url: 'https://x.com/2' }, ...feed];
    await automationsRpc(owner, 'run_now', { id: saved.id });
    const second = await runDueAutomations(anon, 's3cret', push);
    expect(second[0]).toMatchObject({ status: 'ok', pushed: 'HN: 1 new post' });
    expect(pushes).toContain('HN: 1 new post');

    // Status is recorded for the Automations page.
    const [row] = await automationsRpc<any[]>(owner, 'list');
    expect(row.last_status).toBe('ok');
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());

    // Changes by the Slates agent count for "since you last looked".
    const { history } = await import('@/lib/history');
    const changes = await history.changes({ client: owner, token: null }, new Date(Date.now() - 60_000).toISOString());
    expect(changes.boards.map((b) => b.slug)).toContain('hn');
  });

  it('a failing automation is marked failed and tells the person', async () => {
    const { ensureAssistant, automationsRpc } = await import('@/lib/automations');
    const { runDueAutomations } = await import('@/lib/automations-run');
    const pg = await freshDb();
    await pg.exec(`insert into public.app_config values ('cron_secret_hash', encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
    const owner = fakeClient(pg, USER) as any;
    await owner.rpc('push_subscribe', { p_endpoint: 'https://push.example.com/a', p_p256dh: 'k', p_auth: 'a' });
    await ensureAssistant(owner);
    const saved = await automationsRpc<{ id: string }>(owner, 'save', { kind: 'rss', title: 'Broken', every: 'daily', at_hour: 7, config: { url: 'https://x.com/feed' } });
    feed = null as any; // makes the job throw
    await automationsRpc(owner, 'run_now', { id: saved.id });
    const pushes: string[] = [];
    const r = await runDueAutomations(fakeClient(pg, null) as any, 's3cret', (async (_t: unknown, p: { title: string }) => (pushes.push(p.title), { sent: 1, failed: 0 })) as any);
    expect(r[0].status).toBe('error');
    expect(pushes).toEqual(["Broken didn't run"]);
    const [row] = await automationsRpc<any[]>(owner, 'list');
    expect(row.last_status).toBe('error');
  });
});
