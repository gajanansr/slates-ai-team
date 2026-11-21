import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Caller } from '@/lib/slates';

export const USER = '11111111-1111-1111-1111-111111111111';

/** Fresh database with the Supabase stub + all migrations applied. */
export async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz, invited_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    create publication supabase_realtime;
    insert into auth.users values ('${USER}', 'u@example.com');
  `);
  const dir = path.join(import.meta.dirname, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).sort()) await pg.exec(readFileSync(path.join(dir, f), 'utf8'));
  return pg;
}

/**
 * Minimal stand-in for a supabase-js client: rpc() runs the function in PGlite under
 * the right role, and errors carry the SQLSTATE in `code` like PostgREST does.
 */
export function fakeClient(pg: PGlite, user: string | null) {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      await pg.exec(`set role ${user ? 'authenticated' : 'anon'}`);
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
      try {
        if (fn === 'slates_exec') {
          const r = await pg.query<{ r: unknown }>('select public.slates_exec($1, $2::jsonb, $3) as r', [
            args.p_op,
            JSON.stringify(args.p_args ?? {}),
            args.p_token ?? null,
          ]);
          return { data: r.rows[0].r, error: null };
        }
        // Any other function: named-argument call, like PostgREST does.
        if (!/^[a-z_]+$/.test(fn)) throw new Error('bad rpc name ' + fn);
        const entries = Object.entries(args ?? {}).filter(([, v]) => v !== undefined);
        const list = entries.map(([k], i) => `${k} => $${i + 1}`).join(', ');
        const r = await pg.query<{ r: unknown }>(`select public.${fn}(${list}) as r`, entries.map(([, v]) => v));
        return { data: r.rows[0].r, error: null };
      } catch (e: any) {
        return { data: null, error: { code: e.code, message: e.message } };
      } finally {
        await pg.exec('reset role');
      }
    },
  };
}

export const userCaller = (pg: PGlite): Caller => ({ client: fakeClient(pg, USER) as any, token: null });
export const tokenCaller = (pg: PGlite, token: string): Caller => ({ client: fakeClient(pg, null) as any, token });

export async function mintToken(pg: PGlite, name = 'Claude', scopes = ['read', 'write']) {
  const { data } = await fakeClient(pg, USER).rpc('create_agent', { p_name: name, p_kind: 'claude', p_scopes: scopes });
  return (data as { token: string }).token;
}
