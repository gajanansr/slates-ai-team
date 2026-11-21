import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { slates } from '@/lib/slates';
import { runTool } from '@/lib/agent/http';
import { groupBoards } from '@/lib/summary';
import { freshDb, mintToken, tokenCaller, userCaller } from './helpers';

let pg: PGlite;
beforeEach(async () => {
  pg = await freshDb();
});

describe('categories', () => {
  it('agents set a category on create and move boards with update; null clears it', async () => {
    const c = tokenCaller(pg, await mintToken(pg));
    const s = await runTool(c, 'create_slate', { title: 'Cards', kind: 'list', data: { items: [] }, category: ' Money ' });
    expect((s as any).category).toBe('Money');
    await runTool(c, 'update_slate', { slug: 'cards', category: 'Finance' });
    expect((await slates.get(userCaller(pg), 'cards')).category).toBe('Finance');
    await runTool(c, 'update_slate', { slug: 'cards', category: null });
    expect((await slates.get(userCaller(pg), 'cards')).category).toBeNull();
    const list = (await runTool(c, 'list_slates', {})) as any[];
    expect(list[0]).not.toHaveProperty('category', 'Finance');
  });

  it('rejects categories longer than 40 chars', async () => {
    await expect(
      runTool(userCaller(pg), 'create_slate', { title: 'x', kind: 'list', data: { items: [] }, category: 'x'.repeat(41) }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('groups by category, falls back to kind, keeps user order with pinned first', async () => {
    const u = userCaller(pg);
    await slates.create(u, { title: 'Bills', kind: 'table', data: { columns: [{ key: 'a', label: 'A' }], rows: [] }, category: 'Money' });
    await slates.create(u, { title: 'Reading', kind: 'list', data: { items: [] } });
    await slates.create(u, { title: 'Net worth', kind: 'metrics', data: { items: [] }, category: 'Money', pinned: true });
    const groups = groupBoards(await slates.list(u));
    expect(groups.map((g) => [g.name, g.boards.map((b) => b.title)])).toEqual([
      ['Money', ['Net worth', 'Bills']],
      ['Lists', ['Reading']],
    ]);
    expect(groups[0].slug).toBe('money');
  });
});
