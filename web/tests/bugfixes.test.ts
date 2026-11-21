import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleRpc } from '@/lib/agent/mcp';
import { validateData } from '@/lib/kinds';
import { slates } from '@/lib/slates';
import { freshDb, mintToken, tokenCaller, userCaller } from './helpers';

let pg: PGlite;
let token: string;
const call = (name: string, args: object) =>
  handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;

beforeEach(async () => {
  pg = await freshDb();
  token = await mintToken(pg);
});

describe('BUG-11: canonical board URLs', () => {
  it('create, get and list return an absolute url', async () => {
    const c = await call('create_slate', { title: 'Reading', kind: 'list', data: { items: [] } });
    expect(c.result.structuredContent.url).toBe('https://www.slates.space/s/reading');
    expect((await call('get_slate', { slug: 'reading' })).result.structuredContent.url).toMatch(/\/s\/reading$/);
    expect((await call('list_slates', {})).result.structuredContent.result[0].url).toMatch(/\/s\/reading$/);
  });
});

describe('BUG-07: patch_items with expected_version', () => {
  it('a stale version is a clear conflict, not a silent merge', async () => {
    await call('create_slate', { title: 'Inbox', kind: 'list', data: { items: [] } });
    const v = (await call('get_slate', { slug: 'inbox' })).result.structuredContent.version;
    await call('patch_items', { slug: 'inbox', upsert: [{ id: 'a', text: 'first' }], expected_version: v });
    const stale = await call('patch_items', { slug: 'inbox', upsert: [{ id: 'b', text: 'second' }], expected_version: v });
    expect(stale.result.isError).toBe(true);
    expect(stale.result.content[0].text).toMatch(/conflict/);
    const items = (await slates.get(userCaller(pg), 'inbox')).data.items as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('BUG-08: brief updates are silent by default', () => {
  it('set_today_brief logs no notification unless notify is true', async () => {
    await call('set_today_brief', { items: [{ text: 'One' }] });
    let act = await slates.activity(userCaller(pg), 10);
    expect(act.some((a) => a.action === 'notified')).toBe(false);
    await call('set_today_brief', { items: [{ text: 'Two' }], notify: true });
    act = await slates.activity(userCaller(pg), 10);
    expect(act.some((a) => a.action === 'notified')).toBe(true);
  });
});

describe('BUG-04 / BUG-05: metric links and widget freshness', () => {
  it('metric items accept safe links only', () => {
    expect(() => validateData('metrics', { items: [{ id: 'a', label: 'Bill', value: '₹999', href: 'https://example.com/pay' }] })).not.toThrow();
    expect(() => validateData('metrics', { items: [{ id: 'a', label: 'Bill', value: '1', href: 'javascript:alert(1)' }] })).toThrow();
  });
  it('widgets carry source / as_of / stale_after_hours', () => {
    const w = { id: 'k', title: 'Gigs', kind: 'metrics', source: 'Gmail', as_of: '2026-11-03T18:00:00+05:30', stale_after_hours: 24, data: { items: [{ id: 'a', label: 'Proposals', value: '6' }] } };
    expect(() => validateData('dashboard', { widgets: [w] })).not.toThrow();
    expect(() => validateData('dashboard', { widgets: [{ ...w, as_of: 'yesterday' }] })).toThrow();
  });
});

describe('replacing data or a note body needs expected_version', () => {
  it('update_slate with data and no version is a conflict that names the current version', async () => {
    await call('create_slate', { title: 'Inbox', kind: 'list', data: { items: [] } });
    const v = (await call('get_slate', { slug: 'inbox' })).result.structuredContent.version;
    const bare = await call('update_slate', { slug: 'inbox', data: { items: [{ id: 'x', text: 'x' }] } });
    expect(bare.result.isError).toBe(true);
    expect(bare.result.content[0].text).toMatch(new RegExp(`conflict.*version ${v}`));
    const ok = await call('update_slate', { slug: 'inbox', data: { items: [{ id: 'x', text: 'x' }] }, expected_version: v });
    expect(ok.result.isError).toBe(false);
    // metadata-only changes still need no version
    expect((await call('update_slate', { slug: 'inbox', pinned: true })).result.isError).toBe(false);
  });
  it('update_note body needs the version; append does not', async () => {
    await call('add_note', { id: 'log', title: 'Log', body: 'a' });
    const bare = await call('update_note', { id: 'log', body: 'b' });
    expect(bare.result.isError).toBe(true);
    expect(bare.result.content[0].text).toMatch(/expected_version/);
    expect((await call('update_note', { id: 'log', append: 'c' })).result.isError).toBe(false);
  });
});
