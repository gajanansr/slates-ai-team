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
const rem = (user: string | null, op: string, args: object = {}, token: string | null = null) =>
  as<any>(user, 'select public.reminders_exec($1, $2::jsonb, $3) as r', [op, JSON.stringify(args), token]);
const iso = (minsFromNow: number) => new Date(Date.now() + minsFromNow * 60000).toISOString();

beforeEach(async () => {
  pg = await freshDb();
  await pg.exec(`insert into auth.users values ('${OTHER}', 'o@example.com')`);
  await pg.exec(`insert into public.app_config values ('cron_secret_hash', encode(sha256(convert_to('s3cret', 'UTF8')), 'hex'))`);
});

describe('reminders_exec', () => {
  it('agents create reminders for their owner, attributed and logged', async () => {
    const token = await mintToken(pg);
    const r = await rem(null, 'create', { text: 'Call the bank', at: iso(60) }, token);
    expect(r).toMatchObject({ text: 'Call the bank', tz: 'Asia/Kolkata', created_by_name: 'Claude' });
    expect(r.notify_at).toBe(r.due_at);
    expect(await rem(USER, 'list')).toHaveLength(1);
    expect(await rem(OTHER, 'list')).toEqual([]);
    const act = await as<any>(USER, `select public.slates_exec('activity', '{"limit":1}') as r`);
    expect(act[0]).toMatchObject({ action: 'reminder_set', agent_name: 'Claude' });
  });

  it('validates text, time, timezone and repeat', async () => {
    expect(await code(rem(USER, 'create', { text: '', at: iso(5) }))).toBe('P0422');
    expect(await code(rem(USER, 'create', { text: 'x', at: 'tomorrow-ish' }))).toBe('P0422');
    expect(await code(rem(USER, 'create', { text: 'x', at: iso(5), timezone: 'Mars/Olympus' }))).not.toBe('ok');
    expect(await code(rem(USER, 'create', { text: 'x', at: iso(5), repeat: 'hourly' }))).toBe('23514');
  });

  it('read-only tokens can list but not create; others cannot touch my reminders', async () => {
    const ro = await mintToken(pg, 'Reader', ['read']);
    expect(await rem(null, 'list', {}, ro)).toEqual([]);
    expect(await code(rem(null, 'create', { text: 'x', at: iso(5) }, ro))).toBe('P0403');
    const mine = await rem(USER, 'create', { text: 'Mine', at: iso(5) });
    expect(await code(rem(OTHER, 'complete', { id: mine.id }))).toBe('P0404');
    expect(await code(rem(OTHER, 'cancel', { id: mine.id }))).toBe('P0404');
  });

  it('completing a one-off marks it done; completing a repeat rolls it forward', async () => {
    const once = await rem(USER, 'create', { text: 'Once', at: iso(-5) });
    const done = await rem(USER, 'complete', { id: once.id });
    expect(done.done_at).toBeTruthy();
    expect(done.notify_at).toBeNull();
    const daily = await rem(USER, 'create', { text: 'Pills', at: iso(-5), repeat: 'daily' });
    const next = await rem(USER, 'complete', { id: daily.id });
    expect(next.done_at).toBeNull();
    expect(new Date(next.due_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(next.due_at).getTime() - new Date(daily.due_at).getTime()).toBe(86_400_000);
  });

  it('snooze moves it later and cancel deletes it', async () => {
    const r = await rem(USER, 'create', { text: 'Stretch', at: iso(-1) });
    const s = await rem(USER, 'snooze', { id: r.id, minutes: 30 });
    expect(new Date(s.due_at).getTime()).toBeGreaterThan(Date.now() + 29 * 60000);
    await rem(USER, 'cancel', { id: r.id });
    expect(await rem(USER, 'list')).toEqual([]);
  });
});

describe('repeat arithmetic', () => {
  const next = (due: string, tz: string, repeat: string) =>
    pg.query<{ r: string }>(`select to_char(public._next_due($1::timestamptz, $2, $3) at time zone $2, 'YYYY-MM-DD Dy HH24:MI') as r`, [due, tz, repeat]).then((x) => x.rows[0].r);

  it('weekdays skip the weekend and keep local time', async () => {
    // Friday 2030-01-04 09:00 IST, but the clock is "now" (2026), so the next run is >= now.
    // Use a recent Friday so the loop result is deterministic relative to now:
    const fri = await pg.query<{ d: string }>(
      `select to_char(d, 'YYYY-MM-DD') as d from generate_series(current_date - 14, current_date - 1, interval '1 day') d where extract(isodow from d) = 5 order by d desc limit 1`,
    );
    const r = await next(`${fri.rows[0].d}T09:00:00+05:30`, 'Asia/Kolkata', 'weekdays');
    expect(r).toMatch(/(Mon|Tue|Wed|Thu|Fri) 09:00$/);
  });

  it('monthly and weekly keep the wall-clock time', async () => {
    expect(await next('2026-01-31T18:30:00+05:30', 'Asia/Kolkata', 'monthly')).toMatch(/18:30$/);
    expect(await next('2026-01-05T07:15:00+05:30', 'Asia/Kolkata', 'weekly')).toMatch(/Mon 07:15$/);
  });
});

describe('cron_due_reminders', () => {
  it('is gated by the cron secret', async () => {
    expect(await code(as(null, 'select public.cron_due_reminders($1) as r', ['nope']))).toBe('P0403');
  });

  it('claims due reminders once, includes subscriptions, advances repeats', async () => {
    await as(USER, 'select public.push_subscribe($1, $2, $3) as r', ['https://push.example.com/a', 'k', 'a']);
    await rem(USER, 'create', { text: 'Due one-off', at: iso(-1), slug: 'today' });
    await rem(USER, 'create', { text: 'Due daily', at: iso(-1), repeat: 'daily' });
    await rem(USER, 'create', { text: 'Later', at: iso(120) });

    const due = await as<any[]>(null, 'select public.cron_due_reminders($1) as r', ['s3cret']);
    expect(due.map((d) => d.text).sort()).toEqual(['Due daily', 'Due one-off']);
    expect(due.find((d) => d.text === 'Due one-off')).toMatchObject({ slug: 'today', subscriptions: [{ endpoint: 'https://push.example.com/a' }] });

    // A second run right away sends nothing (no double pushes).
    expect(await as<any[]>(null, 'select public.cron_due_reminders($1) as r', ['s3cret'])).toEqual([]);

    const list = await rem(USER, 'list');
    const oneOff = list.find((r: any) => r.text === 'Due one-off');
    const daily = list.find((r: any) => r.text === 'Due daily');
    expect(oneOff.done_at).toBeNull(); // stays on the list until ticked
    expect(oneOff.notify_at).toBeNull();
    expect(oneOff.sent_at).toBeTruthy();
    expect(new Date(daily.notify_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('done reminders never fire', async () => {
    const r = await rem(USER, 'create', { text: 'Done already', at: iso(-1) });
    await rem(USER, 'complete', { id: r.id });
    expect(await as<any[]>(null, 'select public.cron_due_reminders($1) as r', ['s3cret'])).toEqual([]);
  });
});

describe('timezone setting', () => {
  it('only the signed-in user sets their own; invalid zones are rejected', async () => {
    await as(USER, `select public.set_timezone('Europe/Lisbon') as r`);
    expect(await as(USER, `select timezone as r from public.user_settings`)).toBe('Europe/Lisbon');
    expect(await code(as(USER, `select public.set_timezone('Nope/Nowhere') as r`))).not.toBe('ok');
    expect(await code(as(null, `select public.set_timezone('UTC') as r`))).toBe('42501');
    const r = await rem(USER, 'create', { text: 'x', at: iso(5) });
    expect(r.tz).toBe('Europe/Lisbon');
  });
});
