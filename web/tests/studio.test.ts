import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { DAIRY_REPLY } from './studio-fixture';
import { freshDb, mintToken, tokenCaller, userCaller } from './helpers';
import { agentSlug, boardSlug, BlueprintSchema, extractJson, firstReminderAt, manifestSlug, nextRun, repairBlueprint, type Blueprint } from '@/lib/studio/blueprint';
import { applyBlueprint, getAgent, listAgents, spokenSummary, type BuildEvent } from '@/lib/studio/build';

vi.mock('server-only', () => ({}));
// The model call is the one thing not run in tests: it returns the dairy fixture.
vi.mock('@/lib/studio/generate', async () => {
  const { repairBlueprint } = await import('@/lib/studio/blueprint');
  const { DAIRY_REPLY } = await import('./studio-fixture');
  return {
    studioReady: () => true,
    generateBlueprint: vi.fn(async (goal: string) => ({ ...repairBlueprint(structuredClone(DAIRY_REPLY), goal), provider: 'fixture' })),
  };
});

const clone = <T,>(v: T): T => structuredClone(v);
const dairy = () => repairBlueprint(clone(DAIRY_REPLY), 'manage my dairy business');

describe('blueprint schema', () => {
  it('a good blueprint passes as is', () => {
    const { blueprint } = dairy();
    expect(BlueprintSchema.safeParse(blueprint).success).toBe(true);
    // Round trip: a valid blueprint goes through repair unchanged.
    expect(repairBlueprint(clone(blueprint)).blueprint).toEqual(blueprint);
    expect(blueprint.name).toBe('Dairy Manager');
    expect(blueprint.boards.map((b) => b.kind)).toEqual(['dashboard', 'table', 'tracker', 'table', 'list']);
  });

  it('repairs invalid board data instead of failing', () => {
    const { blueprint } = dairy();
    const customers = blueprint.boards.find((b) => b.title === 'Customers')!.data as any;
    expect(customers.rows[0].cells.litres).toBe('2'); // number -> text cell
    const cattle = blueprint.boards.find((b) => b.title === 'Cattle health')!.data as any;
    expect(cattle.items.find((i: any) => i.id === 'cow-2').stage).toBe('healthy'); // unknown stage -> first stage
  });

  it('drops boards and widgets that cannot be repaired, and items that break their kind', () => {
    const raw = clone(DAIRY_REPLY) as any;
    raw.boards.push({ title: 'Mood board', kind: 'pinterest', data: {} });
    raw.boards.push({ title: 'Broken goals', kind: 'goals', data: { items: [{ title: 'No target', current: 3, target: 0 }] } });
    raw.boards[0].data.widgets.push({ id: 'x', title: 'Nope', kind: 'brief', data: {} });
    raw.boards[0].data.widgets.push({ id: 'y', title: 'Empty chart', kind: 'chart', data: { labels: [] } });
    raw.boards[1].data.rows.push({ id: 'bad', cells: { nothing: 'matches' } });
    raw.boards.push({ title: 'Habits', kind: 'habits', data: { items: [{ name: 'Walk the herd', days: ['2026-11-01', '2026-11-02'] }] } });
    const { blueprint, repairs } = repairBlueprint(raw);
    const titles = blueprint.boards.map((b) => b.title);
    expect(titles).not.toContain('Mood board');
    expect(titles).not.toContain('Broken goals');
    expect(blueprint.boards).toHaveLength(6); // capped
    expect((blueprint.boards[0].data as any).widgets.map((w: any) => w.id)).toEqual(['kpis', 'collection', 'today-tasks']);
    expect((blueprint.boards[1].data as any).rows.map((r: any) => r.id)).toEqual(['cust-a', 'cust-b']);
    expect(repairs.join(' ')).toMatch(/unknown kind "pinterest"/);
    const habits = blueprint.boards.find((b) => b.kind === 'habits');
    expect(habits && (habits.data as any).items[0].days).toEqual([]); // never invent a history
  });

  it('rejects an icon outside the list; repair swaps in a safe one', () => {
    const { blueprint } = dairy();
    expect(BlueprintSchema.safeParse({ ...blueprint, icon: 'cow' }).success).toBe(false);
    expect(BlueprintSchema.safeParse({ ...blueprint, icon: '🐄' }).success).toBe(false);
    const fixed = repairBlueprint({ ...clone(DAIRY_REPLY), icon: 'cow' });
    expect(fixed.blueprint.icon).toBe('sparkles');
    expect(fixed.repairs[0]).toMatch(/icon "cow"/);
  });

  it('strips emoji, caps lists and fails only when no board is usable', () => {
    const { blueprint } = repairBlueprint({ ...clone(DAIRY_REPLY), name: '🐄 Dairy Manager', questions: ['a?', 'One?', 'Two?', 'Three?', 'Four?'] });
    expect(blueprint.name).toBe('Dairy Manager');
    expect(blueprint.questions).toEqual(['One?', 'Two?', 'Three?']);
    expect(() => repairBlueprint({ name: 'X', boards: [{ title: 'a', kind: 'nope', data: {} }] })).toThrow(/no usable boards/);
  });

  it('reads JSON out of a fenced or chatty reply', () => {
    expect(extractJson('Here you go:\n```json\n{"name":"A"}\n```')).toEqual({ name: 'A' });
    expect(extractJson('{"name":"B"} done')).toEqual({ name: 'B' });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('slugs and schedules', () => {
  it('slugs are stable and derived from the agent name', () => {
    expect(agentSlug('Dairy Manager')).toBe('dairy-manager');
    expect(agentSlug('Dairy  Manager!')).toBe('dairy-manager');
    expect(boardSlug('dairy-manager', 'Cattle health')).toBe('dairy-manager-cattle-health');
    expect(boardSlug('dairy-manager', 'Cattle health', 2)).toBe('dairy-manager-cattle-health-2');
    expect(manifestSlug('dairy-manager')).toBe('agent-dairy-manager');
    const long = boardSlug('a'.repeat(40), 'b'.repeat(60));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
  });

  it('next run and first reminder land in the future at the right local time', () => {
    const now = new Date('2026-11-21T10:00:00+05:30'); // a Saturday
    expect(nextRun({ every: 'daily', at_hour: 8 }, 'Asia/Kolkata', now).toISOString()).toBe('2026-11-22T02:30:00.000Z');
    expect(nextRun({ every: 'weekly', at_hour: 10, at_weekday: 1 }, 'Asia/Kolkata', now).toISOString()).toBe('2026-11-23T04:30:00.000Z');
    expect(firstReminderAt({ text: 'x', time: '18:30', repeat: 'daily' }, 'Asia/Kolkata', now).toISOString()).toBe('2026-11-21T13:00:00.000Z');
  });
});

describe('builder', () => {
  let pg: PGlite;
  beforeEach(async () => {
    pg = await freshDb();
  });

  it('creates the boards, notes, reminders and manifest through slates_exec', async () => {
    const c = userCaller(pg);
    const events: BuildEvent[] = [];
    const m = await applyBlueprint(c, dairy().blueprint, { goal: 'manage my dairy business', timezone: 'Asia/Kolkata', emit: (e) => events.push(e) });
    const { slates } = await import('@/lib/slates');
    const all = await slates.list(c);
    const mine = all.filter((s) => s.category === 'Dairy Manager');
    expect(mine.map((s) => s.slug).sort()).toEqual(
      ['dairy-manager-cattle-health', 'dairy-manager-customers', 'dairy-manager-daily-routine', 'dairy-manager-feed-stock', 'dairy-manager-today-at-the-dairy'].sort(),
    );
    const dash = mine.find((s) => s.kind === 'dashboard')!;
    expect((dash.data as any).widgets.at(-1)).toMatchObject({ kind: 'note', data: { note: 'agent-dairy-manager' } });
    // The manifest is a hidden board; the agent reads back from it.
    const manifest = all.find((s) => s.slug === 'agent-dairy-manager')!;
    expect(manifest.hidden).toBe(true);
    expect(await getAgent(c, 'dairy-manager')).toMatchObject({ name: 'Dairy Manager', color: 'green', boards: m.boards });
    expect((await listAgents(c)).map((a) => a.manifest.slug)).toEqual(['dairy-manager']);
    // Notes: the playbook (tagged playbook + the space) and the starter note.
    const { notes } = await import('@/lib/notes');
    const list = await notes.list(c);
    const playbook = list.find((n) => n.id === 'agent-dairy-manager')!;
    expect(playbook.tags).toEqual(['playbook', 'Dairy Manager']);
    expect(playbook.body).toContain('Morning collection check');
    expect(list.some((n) => n.id === 'dairy-manager-getting-started-with-dairy-manager')).toBe(true);
    // Routines without an automation are recorded in the playbook.
    expect(m.routines.every((r) => r.mode === 'playbook')).toBe(true);
    const { reminders } = await import('@/lib/reminders');
    expect((await reminders.list(c)).map((r) => r.text).sort()).toEqual(['Collect monthly payments', 'Log the evening milk collection']);
    expect(events.filter((e) => e.type === 'piece' && e.piece === 'board').map((e: any) => e.status)).toEqual(['created', 'created', 'created', 'created', 'created']);
    expect(spokenSummary(m)).toMatch(/^Dairy Manager is ready\. It has 5 boards: /);
  });

  it('is idempotent: a retry keeps everything and adds nothing', async () => {
    const c = userCaller(pg);
    const bp: Blueprint = dairy().blueprint;
    const first = await applyBlueprint(c, bp, { goal: 'g', timezone: 'Asia/Kolkata' });
    const { slates } = await import('@/lib/slates');
    const { reminders } = await import('@/lib/reminders');
    const { notes } = await import('@/lib/notes');
    const before = { boards: (await slates.list(c)).length, reminders: (await reminders.list(c)).length, notes: (await notes.list(c)).length };
    const events: BuildEvent[] = [];
    const second = await applyBlueprint(c, bp, { goal: 'g', timezone: 'Asia/Kolkata', emit: (e) => events.push(e) });
    expect({ boards: (await slates.list(c)).length, reminders: (await reminders.list(c)).length, notes: (await notes.list(c)).length }).toEqual(before);
    expect(second.boards).toEqual(first.boards);
    expect(second.created_at).toBe(first.created_at);
    expect(events.filter((e) => e.type === 'piece' && e.piece !== 'note').every((e: any) => e.status === 'kept' || e.status === 'recorded')).toBe(true);
  });

  it('runs a routine as an automation when one fits, and falls back to the playbook when it cannot', async () => {
    const c = userCaller(pg);
    const raw = clone(DAIRY_REPLY) as any;
    raw.routines.push({ title: 'Milk price news', schedule: { every: 'daily', at_hour: 7 }, does: 'Follow dairy market news.', automation: { kind: 'rss', url: 'https://example.com/feed' } });
    raw.routines.push({ title: 'Morning brief', schedule: { every: 'daily', at_hour: 6 }, does: 'Plan the day.', automation: { kind: 'brief' } });
    const bp = repairBlueprint(raw).blueprint;
    const save = vi.fn(async (input: any) => {
      if (input.kind === 'brief') throw new Error('This needs Ask Slates, which is not set up yet.');
      return { id: 'auto-1', next_run_at: null };
    });
    const m = await applyBlueprint(c, bp, { goal: 'g', timezone: 'Asia/Kolkata', automations: { list: async () => [], save } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rss', title: 'Milk price news', every: 'daily', at_hour: 7, config: { url: 'https://example.com/feed' } }));
    expect(m.routines.find((r) => r.title === 'Milk price news')).toMatchObject({ mode: 'automation', automation_id: 'auto-1' });
    expect(m.routines.find((r) => r.title === 'Morning brief')).toMatchObject({ mode: 'playbook', note: expect.stringMatching(/not set up/) });
    // A retry finds the automation by title instead of saving a second one.
    save.mockClear();
    await applyBlueprint(c, bp, { goal: 'g', timezone: 'Asia/Kolkata', automations: { list: async () => [{ id: 'auto-1', kind: 'rss', title: 'Milk price news' }], save } });
    expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'rss' }));
  });

  it('never writes over a board that belongs to something else', async () => {
    const c = userCaller(pg);
    const { slates } = await import('@/lib/slates');
    await slates.create(c, { slug: 'dairy-manager-customers', title: 'My own list', kind: 'list', data: { items: [] }, category: 'Work' });
    const m = await applyBlueprint(c, dairy().blueprint, { goal: 'g', timezone: 'Asia/Kolkata' });
    expect(m.boards.map((b) => b.slug)).toContain('dairy-manager-customers-2');
    expect((await slates.get(c, 'dairy-manager-customers')).title).toBe('My own list');
  });
});

describe('build_agent tool', () => {
  let pg: PGlite;
  beforeEach(async () => {
    pg = await freshDb();
  });

  it('is registered as a write tool with a daily limit of 5, and Ask routes to it', async () => {
    const { TOOL_BY_NAME } = await import('@/lib/agent/tools');
    const t = TOOL_BY_NAME.get('build_agent')!;
    expect(t).toBeDefined();
    expect(t.readOnly).toBe(false);
    expect(t.limit).toEqual({ max: 5, per: 'day' });
    expect(t.input.safeParse({ goal: 'manage my dairy business' }).success).toBe(true);
    expect(t.input.safeParse({}).success).toBe(false);
    const { route, TOOLS_FOR } = await import('@/lib/ask-router');
    expect(TOOLS_FOR.build_agent).toEqual(['build_agent']);
    expect(TOOLS_FOR.other).toContain('build_agent');
    for (const q of ['Hey Slates, manage my dairy business for me', 'build me an agent that tracks my fitness', 'Can you run my side-project launch?']) {
      expect((await route(q, [])).intent, q).toBe('build_agent');
    }
    for (const q of ['manage my reminders', 'add milk to groceries', 'what is due today?']) expect((await route(q, [])).intent, q).not.toBe('build_agent');
  });

  it('builds over MCP with an agent token, returns url + summary, and stops after 5 a day', async () => {
    const token = await mintToken(pg);
    const { handleRpc } = await import('@/lib/agent/mcp');
    const call = (args: object) => handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'build_agent', arguments: args } } as any) as Promise<any>;
    const r = await call({ goal: 'manage my dairy business' });
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent).toMatchObject({ agent: 'Dairy Manager', url: expect.stringMatching(/\/agents\/studio\/dairy-manager$/), summary: expect.stringMatching(/Dairy Manager is ready/) });
    expect(r.result.structuredContent.questions).toHaveLength(3);
    for (let i = 0; i < 4; i++) expect((await call({ goal: 'manage my dairy business' })).result.isError).toBe(false);
    const over = await call({ goal: 'manage my dairy business' });
    expect(over.result.isError).toBe(true);
    expect(over.result.content[0].text).toMatch(/5 agents in the last 24 hours/);
  });

  it('refuses read-only tokens before calling the model', async () => {
    const token = await mintToken(pg, 'Reader', ['read']);
    const { buildAgent } = await import('@/lib/studio/service');
    const { generateBlueprint } = await import('@/lib/studio/generate');
    (generateBlueprint as any).mockClear();
    await expect(buildAgent(tokenCaller(pg, token), { goal: 'manage my dairy business' })).rejects.toThrow(/write access/);
    expect(generateBlueprint).not.toHaveBeenCalled();
  });
});
