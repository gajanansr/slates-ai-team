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
const reserve = (c: string, email: string, ip = 'iphash-1') => as<string>(null, 'select public.code_reserve($1, $2, $3) as r', [c, email, ip]);

beforeEach(async () => {
  pg = await freshDb();
  await pg.exec(`update public.members set role = 'admin' where user_id = '${USER}'`);
});

describe('invite codes', () => {
  it('only admins create codes; random codes look like SLATES-XXXXXX', async () => {
    expect(await code(as(null, `select public.admin_create_code('x', 5, 7) as r`))).toBe('42501');
    await pg.exec(`insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'm@example.com')`);
    expect(await code(as('22222222-2222-2222-2222-222222222222', `select public.admin_create_code('x', 5, 7) as r`))).toBe('P0403');
    const c = await as<any>(USER, `select public.admin_create_code('Twitter launch', 2, 30) as r`);
    expect(c.code).toMatch(/^SLATES-[0-9A-F]{6}$/);
    expect(c).toMatchObject({ label: 'Twitter launch', max_uses: 2, uses: 0 });
  });

  it('anyone can redeem a valid code until it is used up; failed sends give the use back', async () => {
    await as(USER, `select public.admin_create_code('', 2, 0, 'launch-24') as r`);
    const r1 = await reserve('launch-24', 'A@Example.com');
    expect(r1).toBeTruthy();
    await reserve('LAUNCH-24', 'b@example.com', 'iphash-2');
    expect(await code(reserve('LAUNCH-24', 'c@example.com', 'iphash-3'))).toBe('P0404');
    await pg.query(`select public.code_finish($1, false, null, 'smtp down')`, [r1]); // service role
    expect(await reserve('LAUNCH-24', 'c@example.com', 'iphash-3')).toBeTruthy();
    const codes = await as<any[]>(USER, 'select public.admin_codes() as r');
    expect(codes[0]).toMatchObject({ code: 'LAUNCH-24', uses: 2, max_uses: 2 });
  });

  it('rejects disabled, expired and unknown codes, existing members and duplicate emails', async () => {
    await as(USER, `select public.admin_create_code('', 10, 0, 'OPEN-1') as r`);
    expect(await code(reserve('NOPE-1', 'x@example.com'))).toBe('P0404');
    await reserve('OPEN-1', 'dup@example.com');
    expect(await code(reserve('OPEN-1', 'dup@example.com', 'iphash-9'))).toBe('P0409');
    await pg.exec(`update auth.users set email_confirmed_at = now() where id = '${USER}'`);
    expect(await code(reserve('OPEN-1', 'u@example.com', 'iphash-8'))).toBe('P0409');
    await as(USER, `select public.admin_set_code('OPEN-1', true) as r`);
    expect(await code(reserve('OPEN-1', 'y@example.com', 'iphash-7'))).toBe('P0404');
    await as(USER, `select public.admin_create_code('', 10, 0, 'OLD-1') as r`);
    await pg.exec(`update public.invite_codes set expires_at = now() - interval '1 day' where code = 'OLD-1'`);
    expect(await code(reserve('OLD-1', 'z@example.com', 'iphash-6'))).toBe('P0404');
  });

  it('limits attempts per network hash', async () => {
    await as(USER, `select public.admin_create_code('', 100, 0, 'BIG-1') as r`);
    for (let i = 0; i < 5; i++) await reserve('BIG-1', `p${i}@example.com`, 'same-net');
    expect(await code(reserve('BIG-1', 'p9@example.com', 'same-net'))).toBe('P0429');
  });

  it('users can never mark redemptions failed themselves, nor read the tables', async () => {
    expect(await code(as(USER, `select public.code_finish(gen_random_uuid(), false, null, 'x') as r`))).toBe('42501');
    expect(await code(as(null, 'select count(*) as r from public.invite_codes'))).toBe('42501');
  });

  it('code sign-ups are recorded on the member', async () => {
    await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('33333333-3333-3333-3333-333333333333', 'n@example.com', '{"invite_code":"LAUNCH-24"}')`);
    const m = (await pg.query<any>(`select invite_code from public.members where user_id = '33333333-3333-3333-3333-333333333333'`)).rows[0];
    expect(m.invite_code).toBe('LAUNCH-24');
  });
});

describe('invite recovery', () => {
  const check = (email: string) => pg.query<{ r: string }>('select public.invite_resend_check($1) as r', [email]).then((x) => x.rows[0].r);
  it('only invited, unconfirmed accounts get a re-send, max 3 per hour; others learn nothing extra', async () => {
    await pg.exec(`insert into auth.users (id, email, invited_at) values ('44444444-4444-4444-4444-444444444444', 'inv@example.com', now())`);
    expect(await check('INV@example.com')).toBe('resend');
    expect(await check('inv@example.com')).toBe('resend');
    expect(await check('inv@example.com')).toBe('resend');
    expect(await check('inv@example.com')).toBe('limited');
    expect(await check('nobody@example.com')).toBe('unknown');
    await pg.exec(`update auth.users set email_confirmed_at = now() where id = '44444444-4444-4444-4444-444444444444'`);
    expect(await check('inv@example.com')).toBe('member');
  });
  it('is not callable by browsers (no email enumeration)', async () => {
    expect(await code(as(null, `select public.invite_resend_check('inv@example.com') as r`))).toBe('42501');
  });
});
