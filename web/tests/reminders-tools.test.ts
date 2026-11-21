import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleRpc } from '@/lib/agent/mcp';
import { dayKey, todaysReminders, type Reminder } from '@/lib/reminders';
import { freshDb, mintToken, tokenCaller } from './helpers';

let pg: PGlite;
let token: string;
const call = (name: string, args: object) =>
  handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;

beforeEach(async () => {
  pg = await freshDb();
  token = await mintToken(pg);
});

describe('reminder tools over MCP', () => {
  it('list_reminders gives the agent the time and timezone, then remind schedules a push', async () => {
    const ctx = (await call('list_reminders', {})).result.structuredContent;
    expect(ctx).toMatchObject({ timezone: 'Asia/Kolkata', reminders: [] });
    expect(Date.parse(ctx.now)).not.toBeNaN();

    const at = new Date(Date.now() + 3600_000).toISOString();
    const r = await call('remind', { text: 'Call the bank', at, repeat: 'weekdays' });
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent).toMatchObject({ text: 'Call the bank', repeat: 'weekdays', created_by_name: 'Claude' });

    const id = r.result.structuredContent.id;
    const done = await call('complete_reminder', { id });
    expect(new Date(done.result.structuredContent.due_at).getTime()).toBeGreaterThan(Date.now());
    expect((await call('cancel_reminder', { id })).result.isError).toBe(false);
    expect((await call('list_reminders', {})).result.structuredContent.reminders).toEqual([]);
  });

  it('bad times come back as readable tool errors', async () => {
    const r = await call('remind', { text: 'x', at: 'next tuesday-ish' });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/ISO 8601/);
  });
});

describe('todaysReminders', () => {
  const mk = (id: string, iso: string, done = false) => ({ id, text: id, due_at: iso, done_at: done ? iso : null }) as Reminder;
  it('includes overdue and later-today in the user timezone, excludes tomorrow and done', () => {
    const now = new Date('2026-11-04T10:00:00+05:30');
    const list = [
      mk('overdue-yesterday', '2026-11-03T20:00:00+05:30'),
      mk('today-later', '2026-11-04T23:30:00+05:30'),
      mk('tomorrow', '2026-11-05T00:30:00+05:30'),
      mk('done', '2026-11-04T09:00:00+05:30', true),
    ];
    expect(todaysReminders(list, 'Asia/Kolkata', now).map((r) => r.id)).toEqual(['overdue-yesterday', 'today-later']);
    expect(dayKey('2026-11-04T23:30:00+05:30', 'UTC')).toBe('2026-11-04');
  });
});
