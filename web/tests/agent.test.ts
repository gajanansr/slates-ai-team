import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { handleRpc } from '@/lib/agent/mcp';
import { runTool } from '@/lib/agent/http';
import { TOOLS, toolJsonSchema } from '@/lib/agent/tools';
import { slates } from '@/lib/slates';
import { freshDb, mintToken, tokenCaller, userCaller } from './helpers';

let pg: PGlite;
let token: string;
const rpc = (method: string, params?: unknown, opts: { notification?: boolean } = {}) =>
  handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', ...(opts.notification ? {} : { id: 1 }), method, params } as any) as Promise<any>;

beforeEach(async () => {
  pg = await freshDb();
  token = await mintToken(pg);
});

describe('MCP protocol', () => {
  it('initializes with a supported protocol version and instructions', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.instructions).toMatch(/slates/i);
    const r2 = await rpc('initialize', { protocolVersion: '1999-01-01' });
    expect(r2.result.protocolVersion).toBe('2025-11-25');
  });

  it('ignores notifications and rejects unknown methods', async () => {
    expect(await rpc('notifications/initialized', undefined, { notification: true })).toBeNull();
    expect((await rpc('nope')).error.code).toBe(-32601);
  });

  it('lists every tool with an object input schema', async () => {
    const r = await rpc('tools/list');
    expect(r.result.tools.map((t: any) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of r.result.tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema).not.toHaveProperty('$schema');
    }
  });

  it('creates, patches and reads a slate through tools/call', async () => {
    const created = await rpc('tools/call', {
      name: 'create_slate',
      arguments: { title: 'Reading', kind: 'list', data: { items: [{ id: 'dune', text: 'Dune' }] } },
    });
    expect(created.result.isError).toBe(false);
    expect(created.result.structuredContent.slug).toBe('reading');

    await rpc('tools/call', { name: 'patch_items', arguments: { slug: 'reading', upsert: [{ id: 'dune', done: true }, { id: 'sapiens', text: 'Sapiens' }] } });
    const got = await rpc('tools/call', { name: 'get_slate', arguments: { slug: 'reading' } });
    expect(got.result.structuredContent.data.items).toEqual([
      { id: 'dune', text: 'Dune', done: true },
      { id: 'sapiens', text: 'Sapiens' },
    ]);
    expect(got.result.structuredContent.updated_by_name).toBe('Claude');

    const list = await rpc('tools/call', { name: 'list_slates', arguments: {} });
    expect(list.result.structuredContent.result[0]).toMatchObject({ slug: 'reading', size: '2 items', updated_by: 'Claude' });
  });

  it('returns validation problems as tool errors the model can read', async () => {
    const r = await rpc('tools/call', { name: 'create_slate', arguments: { title: 'x', kind: 'links', data: { items: [{ id: 'a', title: 't', url: 'nope' }] } } });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/invalid/i);
    const r2 = await rpc('tools/call', { name: 'get_slate', arguments: { slug: 'missing' } });
    expect(r2.result.content[0].text).toMatch(/not_found/);
  });

  it('set_today_brief creates then replaces the brief', async () => {
    await rpc('tools/call', { name: 'set_today_brief', arguments: { date: 'Tue', items: [{ text: 'One' }] } });
    await rpc('tools/call', { name: 'set_today_brief', arguments: { date: 'Wed', items: [{ text: 'Two', tone: 'bad' }] } });
    const s = await slates.get(userCaller(pg), 'today');
    expect(s.pinned).toBe(true);
    expect(s.data).toEqual({ date: 'Wed', items: [{ id: 'b1', text: 'Two', tone: 'bad' }] });
  });

  it('log_activity and recent_activity round-trip with attribution', async () => {
    await rpc('tools/call', { name: 'log_activity', arguments: { message: 'Synced 12 tasks' } });
    const r = await rpc('tools/call', { name: 'recent_activity', arguments: { limit: 5 } });
    expect(r.result.structuredContent.result[0]).toMatchObject({ action: 'note', summary: 'Synced 12 tasks', agent_name: 'Claude' });
  });
});

describe('tool argument validation', () => {
  it('rejects unknown kinds before touching the database', async () => {
    await expect(runTool(tokenCaller(pg, token), 'create_slate', { title: 'x', kind: 'weird', data: {} })).rejects.toMatchObject({ status: 422 });
  });
  it('rejects a slug path traversal attempt', async () => {
    await expect(runTool(tokenCaller(pg, token), 'get_slate', { slug: '../../etc' })).rejects.toMatchObject({ status: 422 });
  });
  it('read-only tokens get 403 on writes', async () => {
    const ro = await mintToken(pg, 'Reader', ['read']);
    await expect(runTool(tokenCaller(pg, ro), 'log_activity', { message: 'x' })).rejects.toMatchObject({ status: 403 });
  });
  it('all tool schemas are JSON-schema serialisable', () => {
    for (const t of TOOLS) expect(() => JSON.stringify(toolJsonSchema(t))).not.toThrow();
  });
});

describe('concurrency', () => {
  it('parallel patch_items from two agents both land', async () => {
    await slates.create(userCaller(pg), { title: 'Inbox', kind: 'list', data: { items: [] } });
    const other = await mintToken(pg, 'Grok');
    await Promise.all([
      slates.patchItems(tokenCaller(pg, token), 'inbox', { upsert: [{ id: 'a', text: 'from claude' }] }),
      slates.patchItems(tokenCaller(pg, other), 'inbox', { upsert: [{ id: 'b', text: 'from grok' }] }),
    ]);
    const s = await slates.get(userCaller(pg), 'inbox');
    expect((s.data.items as { id: string }[]).map((i) => i.id).sort()).toEqual(['a', 'b']);
  });
});

describe('notify tool', () => {
  it('reports when no device has notifications enabled, and logs the request', async () => {
    const r = await rpc('tools/call', { name: 'notify', arguments: { title: 'Card due tomorrow' } });
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent).toMatchObject({ delivered: 0, skipped: 'no devices have notifications enabled' });
    const act = await slates.activity(userCaller(pg), 5);
    expect(act[0]).toMatchObject({ action: 'notified', summary: 'Card due tomorrow', agent_name: 'Claude' });
  });

  it('is unavailable on the signed-in user path (agents only)', async () => {
    await expect(runTool(userCaller(pg), 'notify', { title: 'x' })).rejects.toMatchObject({ status: 403 });
  });

  it('set_today_brief never fails because of push', async () => {
    const r = await rpc('tools/call', { name: 'set_today_brief', arguments: { items: [{ text: 'One' }] } });
    expect(r.result.isError).toBe(false);
  });
});
