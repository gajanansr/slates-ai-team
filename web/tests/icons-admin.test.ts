import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleRpc } from '@/lib/agent/mcp';
import { ICON_NAMES, isIconName } from '@/lib/icons';
import { ICONS } from '@/components/board-icon';
import { freshDb, mintToken, tokenCaller, USER } from './helpers';

let pg: PGlite;
let token: string;
const call = (name: string, args: object) =>
  handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;

beforeEach(async () => {
  pg = await freshDb();
  token = await mintToken(pg);
});

describe('board icons', () => {
  it('every allowed name has a glyph', () => {
    for (const n of ICON_NAMES) expect(ICONS[n], n).toBeTruthy();
    expect(isIconName('wallet')).toBe(true);
    expect(isIconName('🎯')).toBe(false);
  });

  it('agents get a readable error for emoji and succeed with a name', async () => {
    const bad = await call('create_slate', { title: 'Goals', kind: 'list', data: { items: [] }, icon: '🎯' });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/icon/i);
    const ok = await call('create_slate', { title: 'Goals', kind: 'list', data: { items: [] }, icon: 'target' });
    expect(ok.result.structuredContent.icon).toBe('target');
    const reset = await call('update_slate', { slug: 'goals', icon: null });
    expect(reset.result.structuredContent.icon).toBeNull();
  });

  it('the tool schema advertises the allowed names', async () => {
    const r = (await handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/list' } as any)) as any;
    const create = r.result.tools.find((t: any) => t.name === 'create_slate');
    expect(create.inputSchema.properties.icon.enum).toContain('wallet');
  });

  it('the database refuses emoji even if a client bypasses the tools', async () => {
    let code = 'ok';
    try {
      await pg.query(`select public.slates_exec('create', '{"title":"X","kind":"list","data":{"items":[]},"icon":"🚀"}', $1)`, [token]);
    } catch (e: any) {
      code = e.code;
    }
    expect(code).toBe('23514');
  });
});

describe('admin audit', () => {
  it('access changes are logged in the admin activity feed', async () => {
    await pg.exec(`insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'bob@example.com')`);
    await pg.exec(`update public.members set role = 'admin' where user_id = '${USER}'`);
    await pg.exec(`set role authenticated`);
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [USER]);
    try {
      await pg.query(`select public.admin_set_member('22222222-2222-2222-2222-222222222222', true, 3)`);
      const act = (await pg.query<any>(`select public.slates_exec('activity', '{"limit":1}') as r`)).rows[0].r;
      expect(act[0]).toMatchObject({ action: 'admin_change', summary: 'bob@example.com: invites on, allowance 3' });
    } finally {
      await pg.exec('reset role');
    }
  });
});
