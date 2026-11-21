import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, fakeClient, userCaller, USER } from './helpers';
import { slates } from '@/lib/slates';
import { reminders } from '@/lib/reminders';
import { direct, route, compactBoard, snapshot, TOOLS_FOR } from '@/lib/ask-router';
import { parseReminder, zoned, isoInZone } from '@/lib/when';
import { TOOLS } from '@/lib/agent/tools';

const TZ = 'Asia/Kolkata';
// Wed 4 Nov 2026, 10:00 IST
const NOW = new Date('2026-11-04T04:30:00Z');

describe('reminder time parsing (no AI)', () => {
  const p = (s: string) => {
    const r = parseReminder(s, TZ, NOW);
    return r && { text: r.text, at: isoInZone(r.at, TZ) };
  };
  it('handles common phrasings', () => {
    expect(p('remind me at 6pm to call the bank')).toEqual({ text: 'Call the bank', at: '2026-11-04T18:00:00+05:30' });
    expect(p('remind me to call mom in 20 minutes')).toEqual({ text: 'Call mom', at: '2026-11-04T10:20:00+05:30' });
    expect(p('remind me tomorrow to pay rent')?.at).toBe('2026-11-05T09:00:00+05:30');
    expect(p('remind me tomorrow at 7:30am to run')).toEqual({ text: 'Run', at: '2026-11-05T07:30:00+05:30' });
    expect(p('remind me tonight to water the plants')?.at).toBe('2026-11-04T20:00:00+05:30');
    expect(p('remind me on friday at 5pm to submit the report')).toEqual({ text: 'Submit the report', at: '2026-11-06T17:00:00+05:30' });
    expect(p('remind me at 9 to stretch')?.at).toBe('2026-11-04T21:00:00+05:30'); // 9am already passed
    expect(p('remind me to call 2 people at 6pm')).toEqual({ text: 'Call 2 people', at: '2026-11-04T18:00:00+05:30' });
  });
  it('gives up when there is no clear time', () => {
    expect(p('remind me to call the bank')).toBeNull();
    expect(p('remind me sometime next month')).toBeNull();
  });
  it('converts wall time across zones', () => {
    expect(zoned(2026, 1, 15, 9, 0, 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(zoned(2026, 7, 15, 9, 0, 'America/New_York').toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(isoInZone(new Date('2026-07-01T12:00:00Z'), 'America/New_York')).toBe('2026-07-01T08:00:00-04:00');
  });
});

describe('router (rules, without Jev)', () => {
  let pg: PGlite;
  beforeEach(async () => {
    pg = await freshDb();
  });

  it('routes and runs simple actions without a text model', async () => {
    const c = userCaller(pg);
    await slates.create(c, { slug: 'groceries', title: 'Groceries', kind: 'list', data: { items: [{ id: 'o', text: 'Oat milk' }] } });
    await slates.create(c, {
      slug: 'jobs',
      title: 'Job hunt',
      kind: 'tracker',
      data: { stages: [{ id: 'applied', name: 'Applied' }, { id: 'interview', name: 'Interview' }], items: [{ id: 'acme', title: 'Acme · Designer', stage: 'applied' }] },
    });
    const all = await slates.list(c);
    const run = async (q: string) => direct(c, q, await route(q, all), await slates.list(c), TZ);

    const add = await run('add eggs, bread and butter to my groceries list');
    expect(add?.reply).toContain('Groceries');
    expect(((await slates.get(c, 'groceries')).data as any).items.map((i: any) => i.text)).toEqual(['Oat milk', 'Eggs', 'Bread', 'Butter']);

    expect((await run('tick off oat milk on groceries'))?.reply).toContain('Oat milk');
    expect(((await slates.get(c, 'groceries')).data as any).items[0].done).toBe(true);

    expect((await run('move acme to interview'))?.reply).toContain('Interview');
    expect(((await slates.get(c, 'jobs')).data as any).items[0].stage).toBe('interview');

    const r = await run('remind me in 2 hours to stretch');
    expect(r?.reply).toContain('Stretch');
    expect((await reminders.list(c)).map((x) => x.text)).toEqual(['Stretch']);

    expect((await run('find groceries'))?.reply).toContain('/s/groceries');

    // Not simple: handed to the assistant.
    expect(await run('how much did I spend on food last month?')).toBeNull();
    expect(await run('add a goal to save more')).toBeNull(); // no matching list board
    expect((await route('how much is left in my budget?', all)).intent).toBe('question');
  });

  it('snapshot and compact boards stay small and keep ids', async () => {
    const c = userCaller(pg);
    await slates.create(c, { slug: 'g', title: 'Groceries', kind: 'list', data: { items: Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, text: `Item number ${i}` })) } });
    const s = await slates.get(c, 'g');
    const text = compactBoard(s);
    expect(text).toContain('i0 | Item number 0');
    expect(text.length).toBeLessThan(3700);
    expect(snapshot(await slates.list(c), 'g', 'Wed 4 Nov', TZ)).toContain('g | Groceries | list');
  });

  it('every routed tool exists', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const list of Object.values(TOOLS_FOR)) for (const n of list) expect(names.has(n), n).toBe(true);
  });
});

describe('daily AI question cap', () => {
  it('counts per user per day and stops at the limit', async () => {
    const pg = await freshDb();
    const me = fakeClient(pg, USER);
    expect((await me.rpc('ask_take', { p_limit: 2 })).data).toBe(1);
    expect((await me.rpc('ask_take', { p_limit: 2 })).data).toBe(0);
    const third = await me.rpc('ask_take', { p_limit: 2 });
    expect(third.error?.code).toBe('P0429');
    expect((await fakeClient(pg, null).rpc('ask_take', { p_limit: 2 })).error).toBeTruthy();
  });
});
