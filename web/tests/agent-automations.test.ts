import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, fakeClient, mintToken, tokenCaller, USER } from './helpers';

vi.mock('server-only', () => ({}));

let pg: PGlite;
const tool = async (name: string) => (await import('@/lib/agent/tools')).TOOLS.find((t) => t.name === name)!;
const call = async (name: string, token: string, args: Record<string, unknown> = {}) => {
  const t = await tool(name);
  return t.run(tokenCaller(pg, token), t.input.parse(args));
};
const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return `${e.status} ${e.message}`;
  }
};

beforeAll(() => {
  process.env.SLATES_ENC_KEY = randomBytes(32).toString('base64');
});
beforeEach(async () => {
  pg = await freshDb();
});

describe('agents manage automations (BUG-15)', () => {
  it('needs the app to set automations up once; then agents can add, list, edit, pause and delete', async () => {
    const token = await mintToken(pg);
    const feed = { kind: 'rss', title: 'HN', every: 'hourly', config: { source: 'hn', hn_list: 'best', min_score: 250 } };
    expect(await err(call('save_automation', token, feed))).toMatch(/^409 Automations are not set up yet/);

    const { ensureAssistant } = await import('@/lib/automations');
    await ensureAssistant(fakeClient(pg, USER) as any); // what the app does the first time

    const created: any = await call('save_automation', token, feed);
    expect(created).toMatchObject({ kind: 'rss', title: 'HN', enabled: true, config: { source: 'hn', hn_list: 'best', min_score: 250 } });
    expect(await call('list_automations', token)).toHaveLength(1);

    const paused: any = await call('save_automation', token, { id: created.id, kind: 'rss', title: 'HN best', every: 'daily', at_hour: 8, enabled: false, config: { source: 'hn' } });
    expect(paused).toMatchObject({ title: 'HN best', every: 'daily', at_hour: 8, enabled: false, next_run_at: null });
    expect(paused.config.slug).toMatch(/^feed-/); // keeps writing to the same board

    await call('delete_automation', token, { id: created.id });
    expect(await call('list_automations', token)).toEqual([]);
  });

  it('rejects bad feeds; read-only and board-limited tokens can only look', async () => {
    const { ensureAssistant } = await import('@/lib/automations');
    await ensureAssistant(fakeClient(pg, USER) as any);
    const token = await mintToken(pg);
    expect(await err(call('save_automation', token, { kind: 'rss', title: 'x', every: 'hourly', config: { url: 'not a site' } }))).toMatch(/^422 Pick a source/);

    const ro = await mintToken(pg, 'Reader', ['read']);
    expect(await call('list_automations', ro)).toEqual([]);
    expect(await err(call('save_automation', ro, { kind: 'rss', title: 'x', every: 'hourly', config: { source: 'bbc' } }))).toMatch(/^403 this token is read-only/);

    const { data } = await fakeClient(pg, USER).rpc('create_agent', { p_name: 'Scoped', p_kind: 'other', p_scopes: ['read', 'write'], p_days: null, p_boards: ['money'] });
    const scoped = (data as { token: string }).token;
    expect(await err(call('save_automation', scoped, { kind: 'rss', title: 'x', every: 'hourly', config: { source: 'bbc' } }))).toMatch(/^403 tokens limited to some boards/);
  });
});

describe('templates for agents (BUG-18)', () => {
  it('lists templates and creates a board from one', async () => {
    const token = await mintToken(pg);
    const list = (await call('list_templates', token)) as any[];
    expect(list.map((t) => t.id)).toContain('budget');
    const board: any = await call('create_from_template', token, { template: 'habits', title: 'My habits' });
    expect(board).toMatchObject({ title: 'My habits', kind: 'habits' });
    expect(board.url).toContain('/s/');
    expect(await err(call('create_from_template', token, { template: 'nope' }))).toMatch(/^404 Unknown template/);
  });
});

describe('dashboards hold tracker and habits widgets (BUG-16)', () => {
  it('validates both kinds as widgets', async () => {
    const { validateData, EXAMPLES } = await import('@/lib/kinds');
    const data = {
      widgets: [
        { id: 'pipe', title: 'Pipeline', kind: 'tracker', data: EXAMPLES.tracker },
        { id: 'hab', title: 'Habits', kind: 'habits', width: 'half', data: EXAMPLES.habits },
      ],
    };
    expect(() => validateData('dashboard', data)).not.toThrow();
  });
});
