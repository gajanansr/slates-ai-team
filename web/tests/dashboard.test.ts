import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { EXAMPLES, validateData } from '@/lib/kinds';
import { summarize } from '@/lib/summary';
import { handleRpc } from '@/lib/agent/mcp';
import { freshDb, mintToken, tokenCaller } from './helpers';

const w = (over: object = {}) => ({ id: 'k', title: 'KPIs', kind: 'metrics', data: { items: [{ id: 'a', label: 'Leads', value: '52' }] }, ...over });

describe('dashboard schema', () => {
  it('accepts the example', () => {
    expect(() => validateData('dashboard', EXAMPLES.dashboard)).not.toThrow();
  });
  it('validates each widget against its own kind and points at the bad field', () => {
    expect(() => validateData('dashboard', { widgets: [w({ data: { items: [{ id: 'a', label: 'x' }] } })] })).toThrow(/widgets\[0\]|value/);
    expect(() =>
      validateData('dashboard', { widgets: [w({ kind: 'chart', data: { type: 'bar', labels: ['a', 'b'], series: [{ id: 's', name: 'S', values: [1] }] } })] }),
    ).toThrow(/needs 2 values/);
  });
  it('rejects nested dashboards and briefs, empty and oversized dashboards', () => {
    expect(() => validateData('dashboard', { widgets: [w({ kind: 'dashboard', data: { widgets: [] } })] })).toThrow();
    expect(() => validateData('dashboard', { widgets: [w({ kind: 'brief', data: { items: [] } })] })).toThrow();
    expect(() => validateData('dashboard', { widgets: [] })).toThrow(/at least one/);
    expect(() => validateData('dashboard', { widgets: Array.from({ length: 25 }, (_, i) => w({ id: `w${i}` })) })).toThrow(/24 widgets/);
  });
  it('duplicate widget ids are rejected', () => {
    expect(() => validateData('dashboard', { widgets: [w(), w()] })).toThrow(/Duplicate/);
  });
  it('tiles summarise the first metric', () => {
    expect(summarize({ kind: 'dashboard', data: EXAMPLES.dashboard } as any)).toEqual({ stat: '52', label: 'Leads · 5 widgets' });
  });
});

describe('agents build dashboards over MCP', () => {
  let pg: PGlite;
  let token: string;
  beforeEach(async () => {
    pg = await freshDb();
    token = await mintToken(pg);
  });
  const call = (name: string, args: object) =>
    handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;

  it('the instructions steer agents to one dashboard board', async () => {
    const init = (await handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } as any)) as any;
    expect(init.result.instructions).toMatch(/ONE slate of kind "dashboard"/);
  });

  it('create a dashboard, then patch one widget by id', async () => {
    const c = await call('create_slate', { title: 'Launchreel', kind: 'dashboard', data: EXAMPLES.dashboard, category: 'Launchreel' });
    expect(c.result.isError).toBe(false);
    const p = await call('patch_items', { slug: 'launchreel', upsert: [{ id: 'kpis', title: 'This week', kind: 'metrics', data: { items: [{ id: 'leads', label: 'Leads', value: '60' }] } }] });
    expect(p.result.isError).toBe(false);
    const ws = p.result.structuredContent.data.widgets;
    expect(ws).toHaveLength(5);
    expect(ws[0].data.items[0].value).toBe('60');
  });
});
