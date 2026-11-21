import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleRpc } from '@/lib/agent/mcp';
import { validateData, WIDGET_TEXT_MAX } from '@/lib/kinds';
import { notes } from '@/lib/notes';
import { desk } from '@/lib/desk';
import { slates } from '@/lib/slates';
import { initials } from '@/components/avatar';
import { firstLine } from '@/lib/summary';
import { freshDb, mintToken, tokenCaller, userCaller } from './helpers';

let pg: PGlite;
let token: string;
const call = (name: string, args: object) =>
  handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;
const ok = async (name: string, args: object) => {
  const r = await call(name, args);
  expect(r.result.isError, r.result.content?.[0]?.text).toBe(false);
  const sc = r.result.structuredContent;
  return Array.isArray(sc?.result) ? sc.result : sc;
};

beforeEach(async () => {
  pg = await freshDb();
  token = await mintToken(pg);
});

describe('notes tools', () => {
  it('add_note creates the Notes board, stamps author/time and returns a url', async () => {
    const n = await ok('add_note', { title: 'Launch plan', body: '## Goals\n- 100 sign-ups', tags: ['work'] });
    expect(n).toMatchObject({ id: 'launch-plan', title: 'Launch plan', snippet: '100 sign-ups', tags: ['work'], by: 'Claude' });
    expect(n.url).toMatch(/\/notes\/launch-plan$/);
    const board = await slates.get(userCaller(pg), 'notes');
    expect(board.kind).toBe('notes');
    expect(Date.parse((board.data as any).items[0].updated_at)).not.toBeNaN();
  });

  it('same title twice makes two notes; reusing an id updates instead', async () => {
    await ok('add_note', { title: 'Idea', body: 'one' });
    const second = await ok('add_note', { title: 'Idea', body: 'two' });
    expect(second.id).toBe('idea-2');
    await ok('add_note', { id: 'idea', title: 'Idea', body: 'one, revised' });
    const list = await ok('find_notes', {});
    expect(list).toHaveLength(2);
    expect((await ok('get_note', { id: 'idea' })).body).toBe('one, revised');
  });

  it('update_note appends, pins, and find_notes filters by text and tag', async () => {
    await ok('add_note', { title: 'Log', body: 'Day 1', tags: ['journal'] });
    await ok('add_note', { title: 'Groceries', body: 'milk' });
    await ok('update_note', { id: 'log', append: 'Day 2', pinned: true });
    expect((await ok('get_note', { id: 'log' })).body).toBe('Day 1\n\nDay 2');
    expect((await ok('find_notes', {}))[0].id).toBe('log');
    expect((await ok('find_notes', { tag: 'journal' })).map((n: any) => n.id)).toEqual(['log']);
    expect((await ok('find_notes', { query: 'MILK' })).map((n: any) => n.id)).toEqual(['groceries']);
  });

  it('missing notes and bad ids are readable errors', async () => {
    const r = await call('update_note', { id: 'nope', body: 'x' });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/No note with id "nope"/);
    expect((await call('add_note', { id: 'Bad Id!', title: 'x', body: '' })).result.isError).toBe(true);
  });

  it('delete_note waits for the user to approve', async () => {
    await ok('add_note', { title: 'Temp', body: '' });
    const asked = await ok('delete_note', { id: 'temp' });
    expect(asked.status).toBe('pending_approval');
    expect(await notes.list(userCaller(pg))).toHaveLength(1);
    await desk.decide(userCaller(pg), asked.id, true);
    expect(await notes.list(userCaller(pg))).toEqual([]);
    const seen = await ok('check_desk', {});
    expect(seen.answers).toMatchObject([{ id: asked.id, type: 'approval', answer: 'approved' }]);
  });

  it('agents cannot make a second notes board', async () => {
    const r = await call('create_slate', { title: 'My notes', kind: 'notes', data: { items: [] } });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/add_note/);
  });

  it('server instructions tell agents where notes go', async () => {
    const init = (await handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } } as any)) as any;
    expect(init.result.instructions).toMatch(/add_note/);
    expect(init.result.instructions).toMatch(/"kind":"note"/);
  });
});

describe('dashboards and notes', () => {
  const dash = (w: object) => ({ widgets: [{ id: 'w', title: 'W', ...w }] });

  it('a note widget links by id', () => {
    expect(validateData('dashboard', dash({ kind: 'note', data: { note: 'launch-plan' } }))).toBeTruthy();
    expect(() => validateData('dashboard', dash({ kind: 'note', data: {} }))).toThrow();
  });

  it('long markdown in a dashboard is rejected with a pointer to Notes', () => {
    expect(validateData('dashboard', dash({ kind: 'markdown', data: { body: 'short caption' } }))).toBeTruthy();
    expect(() => validateData('dashboard', dash({ kind: 'markdown', data: { body: 'x'.repeat(WIDGET_TEXT_MAX + 1) } }))).toThrow(/Notes with add_note/);
  });

  it('standalone markdown boards keep their larger limit', () => {
    expect(validateData('markdown', { body: 'x'.repeat(5000) })).toBeTruthy();
  });
});

describe('helpers', () => {
  it('initials: first + last name, one letter for one name, email fallback', () => {
    expect(initials('Gajanan Rathod')).toBe('GR');
    expect(initials('  gajanan   singh rathod ')).toBe('GR');
    expect(initials('Gajanan')).toBe('G');
    expect(initials(null, 'gajananrathod@example.com')).toBe('G');
    expect(initials('', '')).toBe('?');
  });

  it('firstLine strips markdown marks', () => {
    expect(firstLine('\n## Goals\n- one')).toBe('Goals');
    expect(firstLine('1. **Bold** [link](https://x.y)')).toBe('Bold link');
  });
});
