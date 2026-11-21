import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, USER } from './helpers';

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
const join = (email: string, ip = 'ip-1', note: string | null = null) =>
  as<any>(null, 'select public.waitlist_join($1, $2, $3, $4) as r', [email, 'Asha', note, ip]);
const OTHER = '22222222-2222-2222-2222-222222222222';

beforeEach(async () => {
  pg = await freshDb();
  await pg.exec(`update public.members set role = 'admin' where user_id = '${USER}'`);
});

describe('waitlist', () => {
  it('anyone can join once; places in line; members are told they already have Slates', async () => {
    expect(await join('A@Example.com')).toEqual({ status: 'added', position: 1 });
    expect(await join('b@example.com', 'ip-2', 'tracking my job hunt')).toEqual({ status: 'added', position: 2 });
    expect(await join('a@example.com')).toEqual({ status: 'already', position: 1 });
    expect(await join('u@example.com')).toEqual({ status: 'member' });
    expect(await code(join('not-an-email'))).toBe('P0422');
  });

  it('limits sign-ups per network', async () => {
    for (let i = 0; i < 5; i++) await join(`p${i}@example.com`, 'same-ip');
    expect(await code(join('p6@example.com', 'same-ip'))).toBe('P0429');
  });

  it('only admins see the list and mark people as let in; waiting people come first', async () => {
    await join('first@example.com');
    await join('second@example.com', 'ip-2');
    await pg.exec(`insert into auth.users (id, email) values ('${OTHER}', 'm@example.com')`);
    expect(await code(as(OTHER, 'select public.admin_waitlist() as r'))).toBe('P0403');
    expect(await code(as(null, 'select public.admin_waitlist() as r'))).toBe('42501');
    expect(await code(as(OTHER, `select public.admin_waitlist_mark('first@example.com') as r`))).toBe('P0403');

    await as(USER, `select public.admin_waitlist_mark('FIRST@example.com') as r`);
    const list = await as<any[]>(USER, 'select public.admin_waitlist() as r');
    expect(list.map((w) => [w.email, w.status])).toEqual([
      ['second@example.com', 'waiting'],
      ['first@example.com', 'invited'],
    ]);
    // Nobody reads the table directly.
    expect(await code(as(OTHER, 'select count(*)::int as r from public.waitlist'))).not.toBe('ok');
  });
});
