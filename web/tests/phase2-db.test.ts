import { createHash, randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, mintToken, USER } from './helpers';

const OTHER = '22222222-2222-2222-2222-222222222222';
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
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function register(name = 'Claude', uris = [REDIRECT]) {
  return as<{ client_id: string }>(null, 'select public.oauth_register_client($1, $2) as r', [name, uris]);
}
async function authorize(clientId: string, challenge: string, scopes = ['read', 'write'], user = USER) {
  return as<string>(user, 'select public.oauth_issue_code($1, $2, $3, $4) as r', [clientId, REDIRECT, challenge, scopes]);
}
async function exchange(c: string, verifier: string, clientId: string, redirect = REDIRECT) {
  return as<any>(null, 'select public.oauth_exchange_code($1, $2, $3, $4) as r', [c, verifier, clientId, redirect]);
}
async function exec(token: string, op = 'list') {
  return as<any>(null, `select public.slates_exec($1, '{}'::jsonb, $2) as r`, [op, token]);
}

beforeEach(async () => {
  pg = await freshDb();
  await pg.exec(`insert into auth.users values ('${OTHER}', 'o@example.com')`);
});

describe('OAuth 2.1 + PKCE', () => {
  it('runs the full authorization_code flow and yields a working agent token', async () => {
    const { client_id } = await register();
    const { verifier, challenge } = pkce();
    const c = await authorize(client_id, challenge);
    expect(c).toMatch(/^slo_/);
    const tok = await exchange(c, verifier, client_id);
    expect(tok).toMatchObject({ token_type: 'Bearer', expires_in: 2592000, scope: 'slates:read slates:write' });
    expect(tok.access_token).toMatch(/^slt_[0-9a-f]{64}$/);
    expect(await exec(tok.access_token)).toEqual([]);
    const agents = await as<any[]>(USER, `select jsonb_agg(jsonb_build_object('name', name, 'kind', kind)) as r from public.agents`);
    expect(agents).toEqual([{ name: 'Claude', kind: 'oauth' }]);
  });

  it('codes are single use', async () => {
    const { client_id } = await register();
    const { verifier, challenge } = pkce();
    const c = await authorize(client_id, challenge);
    await exchange(c, verifier, client_id);
    expect(await code(exchange(c, verifier, client_id))).toBe('P0400');
  });

  it('rejects a wrong verifier, client or redirect', async () => {
    const { client_id } = await register();
    const other = await register('Evil');
    const { verifier, challenge } = pkce();
    const c = await authorize(client_id, challenge);
    expect(await code(exchange(c, pkce().verifier, client_id))).toBe('P0400');
    expect(await code(exchange(c, verifier, other.client_id))).toBe('P0400');
    expect(await code(exchange(c, verifier, client_id, 'https://evil.com/cb'))).toBe('P0400');
    // still usable with the right values (failed attempts roll back)
    expect((await exchange(c, verifier, client_id)).access_token).toBeTruthy();
  });

  it('refuses unregistered redirect URIs and non-https redirects', async () => {
    const { client_id } = await register();
    expect(await code(as(USER, 'select public.oauth_issue_code($1, $2, $3, $4) as r', [client_id, 'https://evil.com', pkce().challenge, ['read']]))).toBe('P0422');
    expect(await code(register('x', ['http://evil.com/cb']))).toBe('P0422');
    expect(await code(register('x', ['javascript:alert(1)']))).toBe('P0422');
    expect((await register('local', ['http://localhost:6274/callback'])).client_id).toMatch(/^slc_/);
  });

  it('anonymous callers cannot mint codes', async () => {
    const { client_id } = await register();
    expect(await code(as(null, 'select public.oauth_issue_code($1, $2, $3, $4) as r', [client_id, REDIRECT, pkce().challenge, ['read']]))).toBe('42501');
  });

  it('read-only grants produce read-only tokens', async () => {
    const { client_id } = await register();
    const { verifier, challenge } = pkce();
    const tok = await exchange(await authorize(client_id, challenge, ['read']), verifier, client_id);
    expect(tok.scope).toBe('slates:read');
    expect(await code(as(null, `select public.slates_exec('log', '{"message":"x"}', $1) as r`, [tok.access_token]))).toBe('P0403');
  });

  it('refresh rotates both tokens and keeps one agent row', async () => {
    const { client_id } = await register();
    const { verifier, challenge } = pkce();
    const t1 = await exchange(await authorize(client_id, challenge), verifier, client_id);
    const t2 = await as<any>(null, 'select public.oauth_refresh_token($1, $2) as r', [t1.refresh_token, client_id]);
    expect(t2.access_token).not.toBe(t1.access_token);
    expect(await code(exec(t1.access_token))).toBe('P0401');
    expect(await exec(t2.access_token)).toEqual([]);
    expect(await code(as(null, 'select public.oauth_refresh_token($1, $2) as r', [t1.refresh_token, client_id]))).toBe('P0400');
    const n = await as<number>(USER, 'select count(*)::int as r from public.agents');
    expect(n).toBe(1);
  });

  it('re-authorizing the same client reuses the agent; revoking kills refresh too', async () => {
    const { client_id } = await register();
    let p = pkce();
    await exchange(await authorize(client_id, p.challenge), p.verifier, client_id);
    p = pkce();
    const t = await exchange(await authorize(client_id, p.challenge), p.verifier, client_id);
    const ids = await as<any[]>(USER, 'select jsonb_agg(id) as r from public.agents');
    expect(ids).toHaveLength(1);
    await as(USER, 'select public.revoke_agent($1) as r', [ids[0]]);
    expect(await code(exec(t.access_token))).toBe('P0401');
    expect(await code(as(null, 'select public.oauth_refresh_token($1, $2) as r', [t.refresh_token, client_id]))).toBe('P0400');
  });

  it('expired access tokens stop working', async () => {
    const { client_id } = await register();
    const { verifier, challenge } = pkce();
    const t = await exchange(await authorize(client_id, challenge), verifier, client_id);
    await pg.exec(`update public.agents set expires_at = now() - interval '1 minute'`);
    expect(await code(exec(t.access_token))).toBe('P0401');
  });

  it('a grant from one user never exposes another user’s data', async () => {
    const { client_id } = await register();
    await as(OTHER, `select public.slates_exec('create', '{"title":"Private","kind":"markdown","data":{"body":"x"}}') as r`);
    const { verifier, challenge } = pkce();
    const t = await exchange(await authorize(client_id, challenge), verifier, client_id);
    expect(await exec(t.access_token)).toEqual([]);
  });

  it('OAuth tables are invisible to clients', async () => {
    expect(await code(as(USER, 'select count(*) as r from public.oauth_codes'))).toBe('42501');
    expect(await code(as(null, 'select count(*) as r from public.oauth_refresh'))).toBe('42501');
    expect(await code(as(null, 'select count(*) as r from public.app_config'))).toBe('42501');
  });
});

describe('web push', () => {
  const sub = (n: string) => [`https://push.example.com/${n}`, 'p256dh-' + n, 'auth-' + n];

  it('subscribe, targets for the owner only, prefs and rate limit', async () => {
    await as(USER, 'select public.push_subscribe($1, $2, $3) as r', sub('a'));
    await as(OTHER, 'select public.push_subscribe($1, $2, $3) as r', sub('b'));
    const token = await mintToken(pg);
    const t = await as<any>(null, 'select public.push_targets($1, $2, $3) as r', [token, 'agent', 'Card due tomorrow']);
    expect(t.sent).toBe(true);
    expect(t.subscriptions.map((s: any) => s.endpoint)).toEqual(['https://push.example.com/a']);

    await as(USER, 'select public.set_notification_prefs(false, true, true) as r');
    expect((await as<any>(null, 'select public.push_targets($1, $2, $3) as r', [token, 'agent', 'x'])).sent).toBe(false);
    expect((await as<any>(null, 'select public.push_targets($1, $2, $3) as r', [token, 'brief', 'x'])).sent).toBe(true);

    for (let i = 0; i < 18; i++) await as(null, 'select public.push_targets($1, $2, $3) as r', [token, 'brief', 'x']);
    expect(await code(as(null, 'select public.push_targets($1, $2, $3) as r', [token, 'brief', 'x']))).toBe('P0429');
  });

  it('read-only and bad tokens cannot notify', async () => {
    const ro = await mintToken(pg, 'Reader', ['read']);
    expect(await code(as(null, 'select public.push_targets($1, $2, $3) as r', [ro, 'agent', 'x']))).toBe('P0403');
    expect(await code(as(null, 'select public.push_targets($1, $2, $3) as r', ['slt_nope', 'agent', 'x']))).toBe('P0401');
  });

  it('subscription keys are not readable by clients; self targets are', async () => {
    await as(USER, 'select public.push_subscribe($1, $2, $3) as r', sub('a'));
    expect(await code(as(USER, 'select auth as r from public.push_subscriptions'))).toBe('42501');
    expect(await as<any[]>(USER, 'select public.push_self_targets() as r')).toHaveLength(1);
    expect(await as<any[]>(OTHER, 'select public.push_self_targets() as r')).toEqual([]);
  });

  it('prune needs a matching owner token or the cron secret', async () => {
    await as(USER, 'select public.push_subscribe($1, $2, $3) as r', sub('a'));
    const otherToken = await (async () => {
      const r = await as<any>(OTHER, `select public.create_agent('x') as r`);
      return r.token as string;
    })();
    await as(null, 'select public.push_prune($1, $2) as r', ['https://push.example.com/a', otherToken]);
    expect(await as<any[]>(USER, 'select public.push_self_targets() as r')).toHaveLength(1);
    expect(await code(as(null, 'select public.push_prune($1) as r', ['https://push.example.com/a']))).toBe('P0403');
    const mine = await mintToken(pg);
    await as(null, 'select public.push_prune($1, $2) as r', ['https://push.example.com/a', mine]);
    expect(await as<any[]>(USER, 'select public.push_self_targets() as r')).toEqual([]);
  });

  it('cron digest is gated by the secret and summarises agent activity', async () => {
    await pg.exec(`insert into public.app_config values ('cron_secret_hash', encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
    expect(await code(as(null, 'select public.cron_digest($1) as r', ['wrong']))).toBe('P0403');
    expect(await code(as(null, 'select public.cron_digest(null) as r'))).toBe('P0403');
    await as(USER, 'select public.push_subscribe($1, $2, $3) as r', sub('a'));
    const token = await mintToken(pg);
    await as(null, `select public.slates_exec('create', '{"title":"Inbox","kind":"list","data":{"items":[]}}', $1) as r`, [token]);
    const d = await as<any[]>(null, 'select public.cron_digest($1) as r', ['s3cret']);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ changes: 1, agents: ['Claude'], slates: ['inbox'] });
    expect(d[0].subscriptions[0].endpoint).toBe('https://push.example.com/a');
  });
});
