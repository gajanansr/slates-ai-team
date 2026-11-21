import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleRpc } from '@/lib/agent/mcp';
import { desk } from '@/lib/desk';
import { about } from '@/lib/about';
import { slates } from '@/lib/slates';
import { freshDb, mintToken, tokenCaller, userCaller } from './helpers';

let pg: PGlite;
let token: string;
const ok = async (name: string, args: object) => {
  const r = (await handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any)) as any;
  expect(r.result.isError, r.result.content?.[0]?.text).toBe(false);
  return r.result.structuredContent;
};

beforeEach(async () => {
  pg = await freshDb();
  token = await mintToken(pg);
});

describe('shared memory', () => {
  it('starts empty, remembers facts under a section, and skips repeats', async () => {
    expect((await ok('get_about_me', {})).known).toBe(false);
    expect((await ok('remember', { fact: 'Prefers short answers', section: 'Preferences' })).remembered).toBe(true);
    expect((await ok('remember', { fact: 'Prefers short answers', section: 'Preferences' })).remembered).toBe(false);
    await ok('remember', { fact: 'Has a dog called Momo', section: 'Pets' });
    const body = (await ok('get_about_me', {})).body as string;
    expect(body.indexOf('- Prefers short answers')).toBeGreaterThan(body.indexOf('## Preferences'));
    expect(body).toContain('## Pets\n- Has a dog called Momo');
    expect((await about.get(userCaller(pg)))?.pinned).toBe(true);
  });
});

describe('the desk', () => {
  it('an agent asks, the user answers, the agent reads it and clears it', async () => {
    const q = await ok('ask_user', { question: 'Track gym in Health or its own space?', options: ['Health', 'Own space'] });
    const mine = await desk.list(userCaller(pg));
    expect(mine).toMatchObject([{ id: q.id, type: 'question', from: 'Claude', open: true, options: ['Health', 'Own space'] }]);
    expect((await ok('check_desk', {})).waiting_on_user).toHaveLength(1);
    await desk.answer(userCaller(pg), q.id, 'Health');
    expect((await ok('check_desk', {})).answers).toMatchObject([{ id: q.id, answer: 'Health' }]);
    await ok('resolve_desk_item', { id: q.id });
    expect(await desk.list(userCaller(pg))).toEqual([]);
  });

  it('the user leaves an instruction about a board; an agent handles it', async () => {
    const me = userCaller(pg);
    const i = await desk.add(me, 'instruction', { text: 'Add November rent', target: { type: 'slate', id: 'money', title: 'Money' } });
    const seen = await ok('check_desk', {});
    expect(seen.instructions).toMatchObject([{ id: i.id, text: 'Add November rent', about: { id: 'money' } }]);
    await ok('resolve_desk_item', { id: i.id, reply: 'Added it' });
    expect((await desk.list(me))[0]).toMatchObject({ open: false, answer: 'Claude: Added it' });
    expect((await ok('check_desk', {})).instructions).toEqual([]);
  });

  it('archiving waits for approval, and declining leaves the board alone', async () => {
    await ok('create_slate', { title: 'Groceries', kind: 'list', data: { items: [] } });
    const asked = await ok('archive_slate', { slug: 'groceries' });
    expect(asked.status).toBe('pending_approval');
    await desk.decide(userCaller(pg), asked.id, false);
    expect((await slates.get(userCaller(pg), 'groceries')).archived_at).toBeNull();
    expect((await slates.get(userCaller(pg), 'desk')).hidden).toBe(true);
  });
});

describe('agents working together', () => {
  it('a closing note and a handoff reach the next agent; search and playbooks work', async () => {
    await ok('end_session', { did: 'Logged October expenses', still_open: 'Rent receipt missing' });
    const h = await ok('hand_off', { task: 'Find the rent receipt in email', to: 'Gemini' });
    const other = await mintToken(pg, 'Gemini');
    const asGemini = async (name: string, args: object) =>
      ((await handleRpc(tokenCaller(pg, other), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any)) as any).result.structuredContent;
    const seen = await asGemini('check_desk', {});
    expect(seen.last_sessions).toMatchObject([{ agent: 'Claude', did: 'Logged October expenses', still_open: 'Rent receipt missing' }]);
    expect(seen.handoffs).toMatchObject([{ id: h.id, from: 'Claude', task: 'Find the rent receipt in email' }]);
    expect((await ok('check_desk', {})).handoffs).toEqual([]); // not shown to the one who sent it
    await asGemini('resolve_desk_item', { id: h.id, reply: 'Attached to Money' });
    expect((await asGemini('check_desk', {})).handoffs).toEqual([]);

    await ok('add_note', { title: 'Weekly review', body: 'Steps', tags: ['playbook'] });
    expect(await ok('list_playbooks', {})).toMatchObject({ result: [{ id: 'weekly-review' }] });
    const found = await ok('search', { query: 'weekly' });
    expect(JSON.stringify(found)).toContain('Weekly review');
  });
});
