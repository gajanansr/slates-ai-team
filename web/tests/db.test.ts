/**
 * Runs the real migrations in an in-process Postgres (PGlite) with a minimal stub of
 * Supabase's auth schema and roles, then verifies isolation and the agent contract.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz, invited_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;
-- legacy table as it exists in production
create table public.money (id int primary key, payload jsonb, updated_at timestamptz default now());
alter table public.money enable row level security;
create policy "owner reads money" on public.money for select to authenticated using (true);
grant select on public.money to authenticated;
insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');
`;

const LEGACY_PAYLOAD = {
  asOf: '3 Nov',
  today: { date: 'Tue 3 Nov', items: [{ text: 'Pay card', tone: 'red' }, { text: 'Gym', tone: 'green' }] },
  summary: { salary: '1,00,000', committed: '1,20,000', gap: '20,000', onCards: '50,000' },
  nextUp: [{ name: 'Card A', amount: '5,000', when: '5 Nov', tone: 'amber' }],
  obligations: [{ label: 'Rent', meta: 'fixed', display: '25,000', pct: 25 }],
  cards: [{ product: 'Card A', bank: 'Bank', main: '10,000', mainLabel: 'due', min: '500', due: '5 Nov', status: 'due', tone: 'red', note: '' }],
  bills: [{ name: 'Internet', sub: 'monthly', amount: '999' }],
  payments: [{ date: '1 Nov', card: 'Card A', amount: '1,000', kind: 'part', via: 'UPI' }],
  limit: { regularLine: 'x', regularLimit: '30k', regularPer: '/mo', regularSub: 's', monthLine: 'y', monthLimit: '10k', monthSub: 't' },
  hq: {
    dashboards: [{ name: 'Dash', href: 'https://example.com/d', detail: 'main' }],
    docs: [{ name: 'Doc', href: 'https://example.com/doc', detail: '' }],
    history: [{ date: '2 Nov', items: ['Did a thing'] }],
  },
  caveat: 'Figures are self-reported.',
};

let pg: PGlite;

type As = { user?: string; token?: string | null };

async function call<T = any>(op: string, args: object = {}, as: As = {}): Promise<T> {
  const role = as.user ? 'authenticated' : 'anon';
  await pg.exec(`set role ${role}`);
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [as.user ?? '']);
  try {
    const r = await pg.query<{ r: T }>('select public.slates_exec($1, $2::jsonb, $3) as r', [op, JSON.stringify(args), as.token ?? null]);
    return r.rows[0].r;
  } finally {
    await pg.exec('reset role');
  }
}

async function asUser<T = any>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.exec('set role authenticated');
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
  try {
    return (await pg.query<T>(sql, params)).rows;
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

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.query('insert into public.money (id, payload) values (1, $1)', [JSON.stringify(LEGACY_PAYLOAD)]);
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).sort()) await pg.exec(readFileSync(path.join(dir, f), 'utf8'));
});

describe('caller resolution', () => {
  it('rejects anonymous callers without a token', async () => {
    expect(await code(call('list'))).toBe('P0401');
  });
  it('rejects unknown tokens', async () => {
    expect(await code(call('list', {}, { token: 'slt_' + '0'.repeat(64) }))).toBe('P0401');
  });
  it('anon cannot read tables directly', async () => {
    await pg.exec('set role anon');
    try {
      expect(await code(pg.query('select * from public.slates'))).toBe('42501');
      expect(await code(pg.query('select * from public.agents'))).toBe('42501');
    } finally {
      await pg.exec('reset role');
    }
  });
});

describe('per-user isolation', () => {
  it('each user only sees their own slates', async () => {
    await call('create', { title: 'A list', kind: 'list', data: { items: [] } }, { user: A });
    await call('create', { title: 'B list', kind: 'list', data: { items: [] } }, { user: B });
    const a = await call<any[]>('list', {}, { user: A });
    const b = await call<any[]>('list', {}, { user: B });
    expect(a.map((s) => s.title)).toContain('A list');
    expect(a.map((s) => s.title)).not.toContain('B list');
    expect(b.map((s) => s.title)).toEqual(['B list']);
    expect(a[0]).not.toHaveProperty('owner_id');
  });

  it('RLS on direct selects returns only own rows', async () => {
    const rows = await asUser<{ title: string }>(B, 'select title from public.slates');
    expect(rows.map((r) => r.title)).toEqual(['B list']);
  });

  it('clients cannot write tables directly', async () => {
    expect(await code(asUser(A, `update public.slates set title = 'x'`))).toBe('42501');
    expect(await code(asUser(A, `insert into public.slates (owner_id, slug, title, kind) values ('${B}', 'pwn', 'pwn', 'list')`))).toBe(
      '42501',
    );
    expect(await code(asUser(A, `delete from public.slates`))).toBe('42501');
  });

  it("a user cannot address another user's slate by slug", async () => {
    await call('create', { slug: 'secret', title: 'B secret', kind: 'markdown', data: { body: 'x' } }, { user: B });
    expect(await code(call('get', { slug: 'secret' }, { user: A }))).toBe('P0404');
    expect(await code(call('update', { slug: 'secret', title: 'hacked' }, { user: A }))).toBe('P0404');
    expect(await code(call('delete', { slug: 'secret' }, { user: A }))).toBe('P0404');
  });

  it('the same slug can exist for two users', async () => {
    await call('create', { slug: 'secret', title: 'A secret', kind: 'markdown', data: { body: 'y' } }, { user: A });
    expect((await call('get', { slug: 'secret' }, { user: A })).title).toBe('A secret');
    expect((await call('get', { slug: 'secret' }, { user: B })).title).toBe('B secret');
  });

  it('token hashes are never readable by clients', async () => {
    expect(await code(asUser(A, 'select token_hash from public.agents'))).toBe('42501');
  });
});

describe('agent tokens', () => {
  let rw: string;
  let ro: string;
  let agentId: string;

  beforeAll(async () => {
    const r1 = await asUser<{ r: any }>(A, `select public.create_agent('Claude', 'claude') as r`);
    rw = r1[0].r.token;
    agentId = r1[0].r.agent.id;
    const r2 = await asUser<{ r: any }>(A, `select public.create_agent('Reader', 'other', array['read']) as r`);
    ro = r2[0].r.token;
  });

  it('issues slt_ tokens and stores only the prefix', async () => {
    expect(rw).toMatch(/^slt_[0-9a-f]{64}$/);
    const rows = await asUser<any>(A, 'select name, token_prefix from public.agents order by created_at');
    expect(rows[0].token_prefix).toBe(rw.slice(0, 12));
  });

  it("acts as its owner and is attributed in activity", async () => {
    const s = await call('create', { title: 'Reading list', kind: 'links', data: { items: [] } }, { token: rw });
    expect(s.slug).toBe('reading-list');
    expect(s.updated_by_name).toBe('Claude');
    const mine = await call<any[]>('list', {}, { user: A });
    expect(mine.map((x) => x.slug)).toContain('reading-list');
    const theirs = await call<any[]>('list', {}, { user: B });
    expect(theirs.map((x) => x.slug)).not.toContain('reading-list');
    const act = await call<any[]>('activity', {}, { user: A });
    expect(act[0]).toMatchObject({ agent_name: 'Claude', action: 'created', slate_slug: 'reading-list' });
  });

  it('read-only tokens cannot write', async () => {
    expect((await call<any[]>('list', {}, { token: ro })).length).toBeGreaterThan(0);
    expect(await code(call('create', { title: 'x', kind: 'list', data: { items: [] } }, { token: ro }))).toBe('P0403');
    expect(await code(call('log', { message: 'hi' }, { token: ro }))).toBe('P0403');
  });

  it('agents cannot hard-delete', async () => {
    expect(await code(call('delete', { slug: 'reading-list' }, { token: rw }))).toBe('P0403');
  });

  it('only the owner can revoke, and revoked tokens stop working', async () => {
    expect(await code(asUser(B, `select public.revoke_agent('${agentId}')`))).toBe('P0404');
    await asUser(A, `select public.revoke_agent('${agentId}')`);
    expect(await code(call('list', {}, { token: rw }))).toBe('P0401');
  });

  it('anon cannot mint tokens', async () => {
    await pg.exec('set role anon');
    try {
      expect(await code(pg.query(`select public.create_agent('x')`))).toBe('42501');
    } finally {
      await pg.exec('reset role');
    }
  });
});

describe('writes', () => {
  it('auto-suffixes slugs derived from titles', async () => {
    const s1 = await call('create', { title: 'Groceries!', kind: 'list', data: { items: [] } }, { user: A });
    const s2 = await call('create', { title: 'Groceries', kind: 'list', data: { items: [] } }, { user: A });
    expect([s1.slug, s2.slug]).toEqual(['groceries', 'groceries-2']);
  });

  it('rejects an explicit duplicate slug', async () => {
    expect(await code(call('create', { slug: 'groceries', title: 'x', kind: 'list', data: { items: [] } }, { user: A }))).toBe('P0409');
  });

  it('enforces optimistic concurrency', async () => {
    const s = await call('get', { slug: 'groceries' }, { user: A });
    await call('update', { slug: 'groceries', title: 'Food', expected_version: s.version }, { user: A });
    expect(await code(call('update', { slug: 'groceries', title: 'Stale', expected_version: s.version }, { user: A }))).toBe('P0409');
    expect((await call('get', { slug: 'groceries' }, { user: A })).title).toBe('Food');
  });

  it('rejects bad kinds and bad slugs', async () => {
    expect(await code(call('create', { title: 'x', kind: 'nope', data: {} }, { user: A }))).toBe('22P02');
    expect(await code(call('create', { slug: 'Bad Slug', title: 'x', kind: 'list', data: {} }, { user: A }))).toBe('23514');
  });

  it('archive hides from list unless asked; restore brings it back', async () => {
    await call('archive', { slug: 'groceries-2' }, { user: A });
    expect((await call<any[]>('list', {}, { user: A })).map((s) => s.slug)).not.toContain('groceries-2');
    expect((await call<any[]>('list', { include_archived: true }, { user: A })).map((s) => s.slug)).toContain('groceries-2');
    await call('restore', { slug: 'groceries-2' }, { user: A });
    expect((await call<any[]>('list', {}, { user: A })).map((s) => s.slug)).toContain('groceries-2');
  });

  it('reorders by slug list', async () => {
    await call('reorder', { slugs: ['groceries-2', 'groceries'] }, { user: A });
    const order = (await call<any[]>('list', {}, { user: A })).map((s) => s.slug);
    expect(order.indexOf('groceries-2')).toBeLessThan(order.indexOf('groceries'));
  });
});

describe('legacy import', () => {
  const OWNER = '33333333-3333-3333-3333-333333333333';

  beforeAll(async () => {
    await pg.exec(`insert into auth.users values ('${OWNER}', 'owner@example.com')`);
  });

  it('the v2 migration alone locks the shared legacy row; import still works', async () => {
    expect(await code(asUser(B, 'select id from public.money'))).toBe('42501');
    const n = (await pg.query<{ n: number }>(`select public._import_money('${OWNER}') as n`)).rows[0].n;
    expect(n).toBe(12);
    expect(await code(asUser(B, 'select id from public.money'))).toBe('42501');
  });

  it('produces typed slates that validate against the app schemas', async () => {
    const { validateData } = await import('@/lib/kinds');
    const list = await call<any[]>('list', {}, { user: OWNER });
    expect(list.map((s) => s.slug)).toEqual([
      'today', 'money', 'next-up', 'obligations', 'cards', 'bills', 'payments', 'spend-limit', 'dashboards', 'docs', 'history', 'notes',
    ].filter((s) => list.some((x) => x.slug === s)));
    for (const s of list) expect(() => validateData(s.kind, s.data), s.slug).not.toThrow();
    const today = list.find((s) => s.slug === 'today');
    expect(today.data.items[0]).toEqual({ id: 'i1', text: 'Pay card', tone: 'bad' });
    const cards = list.find((s) => s.slug === 'cards');
    expect(cards.data.rows[0].cells.product).toBe('Card A');
  });

  it('is idempotent and does not leak to other users', async () => {
    expect((await pg.query<{ n: number }>(`select public._import_money('${OWNER}') as n`)).rows[0].n).toBe(0);
    expect((await call<any[]>('list', {}, { user: B })).map((s) => s.slug)).not.toContain('today');
  });

  it('import helpers are not callable by clients', async () => {
    expect(await code(asUser(A, `select public._import_money('${A}')`))).toBe('42501');
  });
});
