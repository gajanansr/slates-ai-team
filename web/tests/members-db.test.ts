import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, USER } from './helpers';

const ADMIN = USER; // made admin below
const BOB = '22222222-2222-2222-2222-222222222222';
let pg: PGlite;

async function as<T = any>(user: string | null, query: string, params: unknown[] = []): Promise<T> {
  await pg.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  try {
    return (await pg.query<{ r: T }>(query, params)).rows[0]?.r as T;
  } finally {
    await pg.exec('reset role');
  }
}
async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e: any) {
    return e.code as string;
  }
}
const reserve = (user: string, email: string) => as<string>(user, 'select public.invite_reserve($1) as r', [email]);

beforeEach(async () => {
  pg = await freshDb();
  await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${BOB}', 'bob@example.com', '{"invited_by":"${ADMIN}"}')`);
  await pg.exec(`update public.members set role = 'admin' where user_id = '${ADMIN}'`);
});

describe('members', () => {
  it('every auth user gets a member row; invited_by comes from invite metadata', async () => {
    const rows = (await pg.query<any>('select user_id, role, can_invite, invite_quota, invited_by from public.members order by role')).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.user_id === BOB)).toMatchObject({ role: 'member', can_invite: false, invite_quota: 5, invited_by: ADMIN });
  });

  it('members only read their own row', async () => {
    const r = await as<number>(BOB, 'select count(*)::int as r from public.members');
    expect(r).toBe(1);
  });
});

describe('invites', () => {
  it('members need the admin to grant invite access', async () => {
    expect(await code(reserve(BOB, 'carol@example.com'))).toBe('P0403');
    expect(await code(as(BOB, `select public.admin_set_member('${BOB}', true, 5) as r`))).toBe('P0403');
    await as(ADMIN, `select public.admin_set_member('${BOB}', true, 2) as r`);
    expect(await reserve(BOB, 'Carol@Example.com')).toMatch(/[0-9a-f-]{36}/);
    const me = await as<any>(BOB, 'select public.my_membership() as r');
    expect(me).toMatchObject({ role: 'member', can_invite: true, quota: 2, used: 1 });
    expect(me.invites[0]).toMatchObject({ email: 'carol@example.com', status: 'pending', accepted: false });
  });

  it('enforces the quota, duplicates, existing users and valid emails', async () => {
    await as(ADMIN, `select public.admin_set_member('${BOB}', true, 2) as r`);
    await reserve(BOB, 'a@example.com');
    await reserve(BOB, 'b@example.com');
    expect(await code(reserve(BOB, 'c@example.com'))).toBe('P0403');
    expect(await code(reserve(ADMIN, 'a@example.com'))).toBe('P0409');
    expect(await code(reserve(ADMIN, 'bob@example.com'))).toBe('P0409');
    expect(await code(reserve(ADMIN, 'not-an-email'))).toBe('P0422');
  });

  it('admins are not limited by a quota', async () => {
    for (let i = 0; i < 7; i++) await reserve(ADMIN, `x${i}@example.com`);
    expect((await as<any>(ADMIN, 'select public.my_membership() as r')).quota).toBeNull();
  });

  it('users cannot mark their own invites failed to free up quota', async () => {
    await as(ADMIN, `select public.admin_set_member('${BOB}', true, 1) as r`);
    const id = await reserve(BOB, 'a@example.com');
    expect(await code(as(BOB, `select public.invite_finish('${id}', false, null, 'x') as r`))).toBe('42501');
    expect(await code(reserve(BOB, 'b@example.com'))).toBe('P0403');
  });

  it('a failed send frees the slot (server path)', async () => {
    await as(ADMIN, `select public.admin_set_member('${BOB}', true, 1) as r`);
    const id = await reserve(BOB, 'a@example.com');
    await pg.query(`select public.invite_finish($1, false, null, 'smtp down')`, [id]); // service role path
    expect(await reserve(BOB, 'a@example.com')).toBeTruthy();
  });
});

describe('analytics', () => {
  const view = (user: string | null, visitor: string, path: string, extra: unknown[] = []) => {
    const [referrer = null, country = null, device = 'other', standalone = false] = extra;
    return as(user, 'select public.track_view($1, $2, $3, $4, $5, $6) as r', [visitor, path, referrer, country, device, standalone]);
  };

  it('records views with normalised paths and verified attribution', async () => {
    await view(null, 'visitor-aaaa-1', '/?next=/home', ['google.com', 'in', 'mobile', false]);
    await view(BOB, 'visitor-bbbb-2', '/s/my-secret-board#x', [null, 'IN', 'desktop', true]);
    await view(null, 'bad id!', '/');
    await view(null, 'visitor-cccc-3', 'https://evil.com');
    const rows = (await pg.query<any>('select path, user_id, country, device, standalone from public.page_views order by id')).rows;
    expect(rows).toEqual([
      { path: '/', user_id: null, country: 'IN', device: 'mobile', standalone: false },
      { path: '/s/:slug', user_id: BOB, country: 'IN', device: 'desktop', standalone: true },
    ]);
  });

  it('nobody but admins can read analytics or the user list', async () => {
    expect(await code(as(BOB, 'select count(*) as r from public.page_views'))).toBe('42501');
    expect(await code(as(null, 'select count(*) as r from public.page_views'))).toBe('42501');
    expect(await code(as(BOB, 'select public.admin_stats(30) as r'))).toBe('P0403');
    expect(await code(as(BOB, 'select public.admin_users() as r'))).toBe('P0403');
  });

  it('admin_stats and admin_users summarise everything', async () => {
    await view(null, 'visitor-aaaa-1', '/', ['google.com', 'IN', 'mobile', false]);
    await view(BOB, 'visitor-bbbb-2', '/home', [null, 'IN', 'mobile', true]);
    await view(BOB, 'visitor-bbbb-2', '/boards', [null, 'IN', 'mobile', true]);
    const s = await as<any>(ADMIN, 'select public.admin_stats(7) as r');
    expect(s.daily).toHaveLength(7);
    expect(s.totals).toMatchObject({ views: 3, visitors: 2, users: 2, dau: 1, installed_share: 67 });
    expect(s.top_paths[0]).toHaveProperty('views');
    expect(s.devices).toEqual([{ device: 'mobile', visitors: 2 }]);
    expect(s.signups_weekly).toHaveLength(12);
    const users = await as<any[]>(ADMIN, 'select public.admin_users() as r');
    expect(users.find((u) => u.id === BOB)).toMatchObject({ email: 'bob@example.com', invited_by: 'u@example.com', role: 'member' });
  });
});
