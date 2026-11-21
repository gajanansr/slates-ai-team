import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { slates } from '@/lib/slates';
import { handleRpc } from '@/lib/agent/mcp';
import { applyLayout } from '@/lib/layout';
import { validateData } from '@/lib/kinds';
import { activeTabKey, resolvePins, parseLayout, resolveShortcuts, resolveTabs } from '@/lib/app-layout';
import { fakeClient, freshDb, mintToken, tokenCaller, USER } from './helpers';

let pg: PGlite;
const anon = () => fakeClient(pg, null);
const user = () => fakeClient(pg, USER);

beforeEach(async () => {
  pg = await freshDb();
});

describe('agent self-pairing', () => {
  const start = async (name = 'Muse', ip: string | null = null) => {
    const r = await anon().rpc('pair_start', { p_name: name, p_kind: 'muse', p_ip_hash: ip });
    expect(r.error).toBeNull();
    return r.data as { device_secret: string; user_code: string; expires_in: number };
  };

  it('issues a readable code and a secret', async () => {
    const s = await start();
    expect(s.user_code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(s.device_secret.startsWith('slp_')).toBe(true);
    expect(s.expires_in).toBe(600);
  });

  it('stays pending until approved, then hands over a working token exactly once', async () => {
    const s = await start();
    expect((await anon().rpc('pair_poll', { p_device_secret: s.device_secret })).data).toEqual({ status: 'pending' });
    expect((await user().rpc('pair_decide', { p_user_code: s.user_code, p_allow: true, p_scopes: ['read'], p_days: 30 })).error).toBeNull();
    const got = (await anon().rpc('pair_poll', { p_device_secret: s.device_secret })).data as any;
    expect(got.status).toBe('approved');
    expect(got.token.startsWith('slt_')).toBe(true);
    expect(got.scopes).toEqual(['read']);
    expect((await anon().rpc('pair_poll', { p_device_secret: s.device_secret })).data).toEqual({ status: 'claimed' });
    expect(await slates.whoami(tokenCaller(pg, got.token))).toMatchObject({ scopes: ['read'] });
  });

  it('honours the chosen expiry', async () => {
    const s = await start();
    await user().rpc('pair_decide', { p_user_code: s.user_code, p_allow: true, p_days: 7 });
    await anon().rpc('pair_poll', { p_device_secret: s.device_secret });
    const r = await pg.query<{ d: number }>(`select extract(day from expires_at - now())::int as d from agents where name = 'Muse'`);
    expect(r.rows[0].d).toBeGreaterThanOrEqual(6);
    expect(r.rows[0].d).toBeLessThanOrEqual(7);
  });

  it('a denied request never gets a token', async () => {
    const s = await start();
    await user().rpc('pair_decide', { p_user_code: s.user_code, p_allow: false });
    expect((await anon().rpc('pair_poll', { p_device_secret: s.device_secret })).data).toEqual({ status: 'denied' });
    expect((await pg.query(`select 1 from agents`)).rows).toHaveLength(0);
  });

  it('expired and unknown secrets are reported, not crashed on', async () => {
    const s = await start();
    await pg.exec(`update agent_pairings set expires_at = now() - interval '1 minute'`);
    expect((await anon().rpc('pair_poll', { p_device_secret: s.device_secret })).data).toEqual({ status: 'expired' });
    expect((await anon().rpc('pair_poll', { p_device_secret: 'slp_nope' })).data).toEqual({ status: 'invalid' });
    const late = await user().rpc('pair_decide', { p_user_code: s.user_code, p_allow: true });
    expect(late.error?.code).toBe('P0404');
  });

  it('only a signed-in person can look up or decide', async () => {
    const s = await start();
    expect((await anon().rpc('pair_info', { p_user_code: s.user_code })).error?.code).toBe('P0401');
    expect((await anon().rpc('pair_decide', { p_user_code: s.user_code, p_allow: true })).error?.code).toBe('P0401');
    expect((await user().rpc('pair_info', { p_user_code: s.user_code.toLowerCase() })).data).toMatchObject({ name: 'Muse', status: 'pending' });
  });

  it('rejects bad access and expiry choices', async () => {
    const s = await start();
    expect((await user().rpc('pair_decide', { p_user_code: s.user_code, p_allow: true, p_scopes: ['admin'] })).error?.code).toBe('P0422');
    expect((await user().rpc('pair_decide', { p_user_code: s.user_code, p_allow: true, p_days: 0 })).error?.code).toBe('P0422');
  });

  it('rate limits one network', async () => {
    for (let i = 0; i < 20; i++) await start('A' + i, 'iphash');
    const r = await anon().rpc('pair_start', { p_name: 'x', p_kind: 'other', p_ip_hash: 'iphash' });
    expect(r.error?.code).toBe('P0429');
    expect((await anon().rpc('pair_start', { p_name: 'x', p_kind: 'other', p_ip_hash: 'other' })).error).toBeNull();
  });
});

describe('app layout storage', () => {
  const layout = { v: 1, palette: 'ocean' };

  it('is empty at first, then round-trips for the signed-in person', async () => {
    expect((await user().rpc('layout_get', {})).data).toBeNull();
    expect((await user().rpc('layout_set', { p_layout: layout })).error).toBeNull();
    expect((await user().rpc('layout_get', {})).data).toEqual(layout);
    const a = await pg.query(`select 1 from activity where action = 'layout_changed'`);
    expect(a.rows.length).toBeGreaterThan(0);
  });

  it('a write token can change it, a read-only token cannot', async () => {
    const w = await mintToken(pg, 'Writer', ['read', 'write']);
    const r = await mintToken(pg, 'Reader', ['read']);
    expect((await anon().rpc('layout_set', { p_layout: layout, p_token: w })).error).toBeNull();
    expect((await anon().rpc('layout_get', { p_token: r })).data).toEqual(layout);
    expect((await anon().rpc('layout_set', { p_layout: { v: 1 }, p_token: r })).error?.code).toBe('P0403');
  });

  it('a token limited to some boards cannot change it', async () => {
    const t = await mintToken(pg, 'Limited');
    await pg.exec(`update agents set boards = array['a'] where name = 'Limited'`);
    expect((await anon().rpc('layout_set', { p_layout: layout, p_token: t })).error?.code).toBe('P0403');
  });

  it('refuses non-objects and oversized documents', async () => {
    expect((await user().rpc('layout_set', { p_layout: [1] })).error?.code).toBe('P0422');
    expect((await user().rpc('layout_set', { p_layout: { v: 1, pad: 'x'.repeat(21000) } })).error?.code).toBe('P0422');
  });
});

describe('app layout MCP tools', () => {
  it('get/set round-trip and reject unknown board slugs', async () => {
    const token = await mintToken(pg);
    const call = (name: string, args: object) =>
      handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;
    const ok = await call('set_app_layout', { palette: 'sunset', tabs: [{ type: 'route', id: 'home' }, { type: 'route', id: 'ask' }] });
    expect(ok.result.isError).toBe(false);
    const got = await call('get_app_layout', {});
    expect(JSON.stringify(got.result.structuredContent)).toContain('sunset');
    const bad = await call('set_app_layout', { shortcuts: [{ type: 'board', slug: 'does-not-exist' }] });
    expect(bad.result.isError).toBe(true);
  });
});

describe('applyLayout', () => {
  const data = () => ({
    widgets: [
      { id: 'a', title: 'A', kind: 'metrics', data: {} },
      { id: 'b', title: 'B', kind: 'metrics', data: {} },
      { id: 'c', title: 'C', kind: 'metrics', data: {} },
    ],
  });
  it('reorders and keeps unlisted widgets after the listed ones', () => {
    expect(applyLayout(data(), { order: ['c', 'a'] }).widgets.map((w: any) => w.id)).toEqual(['c', 'a', 'b']);
  });
  it('sets and resets per-widget fields; never touches content', () => {
    const set = applyLayout(data(), { widgets: [{ id: 'a', size: 'xl', view: 'ring', hidden: true, section: 'Top' }], look: 'focus' });
    expect(set.widgets[0]).toMatchObject({ size: 'xl', view: 'ring', hidden: true, section: 'Top', data: {} });
    expect(set.look).toBe('focus');
    const reset = applyLayout(set, { widgets: [{ id: 'a', size: null, view: 'auto', hidden: false, section: '' }], look: 'cards' });
    expect(reset.widgets[0]).toEqual({ id: 'a', title: 'A', kind: 'metrics', data: {} });
    expect('look' in reset).toBe(false);
  });
  it('rejects unknown widget ids', () => {
    expect(() => applyLayout(data(), { order: ['zzz'] })).toThrow(/Unknown widget/);
    expect(() => applyLayout(data(), { widgets: [{ id: 'zzz', size: 's' }] })).toThrow(/Unknown widget/);
  });
  it('the dashboard schema accepts the new fields and rejects bad ones', () => {
    const w = (over: object) => ({ widgets: [{ id: 'k', title: 'K', kind: 'metrics', data: { items: [{ id: 'a', label: 'L', value: '1' }] }, ...over }] });
    expect(() => validateData('dashboard', { ...w({ size: 'l', view: 'compact', hidden: true, section: 'S' }), look: 'compact' })).not.toThrow();
    expect(() => validateData('dashboard', w({ size: 'huge' }))).toThrow();
    expect(() => validateData('dashboard', { ...w({}), look: 'weird' })).toThrow();
  });
});

describe('parseLayout and tabs', () => {
  const route = (id: string) => ({ type: 'route', id });
  it('never throws on junk and falls back to defaults', () => {
    expect(parseLayout('nope')).toEqual({ v: 1 });
    expect(parseLayout({ v: 1, tabs: 'x' })).toEqual({ v: 1 });
    expect(parseLayout(null)).toEqual({ v: 1 });
  });
  it('keeps three tabs and moves a legacy fourth to the front of the shortcuts', () => {
    const l = parseLayout({ v: 1, tabs: [route('home'), route('boards'), route('notes'), route('ask')] });
    expect(l.tabs).toHaveLength(3);
    expect(l.shortcuts?.[0]).toEqual(route('ask'));
  });
  it('drops duplicates and the default palette', () => {
    const l = parseLayout({ v: 1, palette: 'lime', tabs: [route('home'), route('home'), route('ask')], home: { blocks: [{ type: 'brief' }, { type: 'brief' }] } });
    expect(l.palette).toBeUndefined();
    expect(l.tabs).toEqual([route('home'), route('ask')]);
    expect(l.home?.blocks).toHaveLength(1);
  });
  it('resolves tabs, leaves tab routes out of shortcuts, skips deleted boards', () => {
    const boards = [{ slug: 'money', title: 'Money', icon: null, kind: 'dashboard' }];
    const l = parseLayout({ v: 1, tabs: [route('home'), { type: 'board', slug: 'money' }, route('ask')], shortcuts: [route('ask'), route('inbox'), { type: 'board', slug: 'gone' }] });
    expect(resolveTabs(l, boards).map((t) => t.key)).toEqual(['home', 'b-money', 'ask']);
    expect(resolveShortcuts(l, boards).map((t) => t.key)).toEqual(['inbox', 'settings']);
  });
  it('Settings is always in the launcher; Admin only for admins', () => {
    const l = parseLayout({ v: 1, shortcuts: [route('inbox'), route('admin')] });
    expect(resolveShortcuts(l, []).map((t) => t.key)).toEqual(['inbox', 'settings']);
    expect(resolveShortcuts(l, [], { admin: true }).map((t) => t.key)).toEqual(['inbox', 'admin', 'settings']);
    expect(resolveShortcuts(parseLayout({ v: 1 }), [], { admin: true }).map((t) => t.key).slice(-2)).toEqual(['settings', 'admin']);
    expect(resolveTabs(parseLayout({ v: 1, tabs: [route('home'), route('admin'), route('ask')] }), [], { admin: false }).map((t) => t.key)).toEqual(['home', 'ask']);
  });
  it('lights up only one tab: a pinned board beats Boards', () => {
    const boards = [{ slug: 'money', title: 'Money', icon: null, kind: 'dashboard' }];
    const tabs = resolveTabs(parseLayout({ v: 1, tabs: [route('home'), route('boards'), { type: 'board', slug: 'money' }] }), boards);
    expect(activeTabKey('/s/money', tabs)).toBe('b-money');
    expect(activeTabKey('/boards', tabs)).toBe('boards');
    expect(activeTabKey('/nowhere', tabs)).toBeNull();
  });
});

describe('Home stays small', () => {
  it('older layouts with many blocks still load, trimmed to five', () => {
    const blocks = [{ type: 'brief' }, { type: 'since' }, ...['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => ({ type: 'board', slug }))];
    const l = parseLayout({ v: 1, home: { blocks } });
    expect(l.home?.blocks).toHaveLength(5);
  });
});

describe('shortcuts in the Apps sheet', () => {
  const boards = [
    { slug: 'money', title: 'Money', icon: null, kind: 'dashboard', pinned: true },
    { slug: 'gym', title: 'Gym', icon: null, kind: 'habits', pinned: false },
  ];
  const notes = [{ id: 'plan', title: 'Plan' }];
  it('start as the boards you had as shortcuts, else your pinned boards', () => {
    expect(resolvePins(parseLayout({ v: 1 }), boards, notes).map((p) => p.key)).toEqual(['b:money']);
    const old = parseLayout({ v: 1, shortcuts: [{ type: 'route', id: 'inbox' }, { type: 'board', slug: 'gym' }] });
    expect(resolvePins(old, boards, notes).map((p) => p.key)).toEqual(['b:gym']);
  });
  it('once chosen they are kept as chosen, notes included; deleted ones and repeats drop out', () => {
    const l = parseLayout({ v: 1, pins: [{ type: 'note', id: 'plan' }, { type: 'board', slug: 'gone' }, { type: 'board', slug: 'gym' }, { type: 'note', id: 'plan' }] });
    expect(resolvePins(l, boards, notes).map((p) => [p.key, p.href])).toEqual([['n:plan', '/notes/plan'], ['b:gym', '/s/gym']]);
    expect(resolvePins(parseLayout({ v: 1, pins: [] }), boards, notes)).toEqual([]);
  });
});
