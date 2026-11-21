import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { validateData, EXAMPLES } from '@/lib/kinds';
import { fmt, latest, niceTicks } from '@/lib/chart-format';
import { summarize } from '@/lib/summary';
import { handleRpc } from '@/lib/agent/mcp';
import { freshDb, mintToken, tokenCaller } from './helpers';

const base = { type: 'bar', labels: ['a', 'b', 'c'], series: [{ id: 's', name: 'S', values: [1, 2, 3] }] };

describe('chart schema', () => {
  it('accepts the example and a multi-series line with gaps', () => {
    expect(() => validateData('chart', EXAMPLES.chart)).not.toThrow();
    expect(() =>
      validateData('chart', { ...base, type: 'line', series: [base.series[0], { id: 't', name: 'T', values: [null, 2, 4] }] }),
    ).not.toThrow();
  });
  it('requires one value per label', () => {
    expect(() => validateData('chart', { ...base, series: [{ id: 's', name: 'S', values: [1, 2] }] })).toThrow(/needs 3 values/);
  });
  it('caps series at 4 and tells the agent to fold into Other', () => {
    const series = [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, name: `S${i}`, values: [1, 2, 3] }));
    expect(() => validateData('chart', { ...base, series })).toThrow(/Other/);
  });
  it('parts: one series, at most 5 parts, no negatives', () => {
    expect(() => validateData('chart', { ...base, type: 'parts' })).not.toThrow();
    expect(() => validateData('chart', { ...base, type: 'parts', series: [{ id: 's', name: 'S', values: [1, -2, 3] }] })).toThrow(/>= 0/);
    expect(() =>
      validateData('chart', { type: 'parts', labels: ['1', '2', '3', '4', '5', '6'], series: [{ id: 's', name: 'S', values: [1, 1, 1, 1, 1, 1] }] }),
    ).toThrow(/at most 5/);
  });
  it('highlight must point at a label', () => {
    expect(() => validateData('chart', { ...base, highlight: 9 })).toThrow(/highlight/);
  });
  it('metric trends render as sparklines and are validated', () => {
    expect(() => validateData('metrics', { items: [{ id: 'a', label: 'x', value: '1', trend: [1, 2, 3] }] })).not.toThrow();
    expect(() => validateData('metrics', { items: [{ id: 'a', label: 'x', value: '1', trend: [1] }] })).toThrow();
  });
});

describe('chart formatting', () => {
  it('nice ticks include zero and cover negatives', () => {
    expect(niceTicks(0, 118000)).toEqual([0, 50000, 100000, 150000]);
    const t = niceTicks(-30, 70);
    expect(t[0]).toBeLessThanOrEqual(-30);
    expect(t).toContain(0);
  });
  it('integer data never gets fractional ticks', () => {
    expect(niceTicks(0, 2, 4, true)).toEqual([0, 1, 2]);
    expect(niceTicks(0, 2, 4)).toContain(0.5);
  });
  it('compact values keep prefix/suffix', () => {
    expect(fmt(104800, { prefix: '₹' })).toBe('₹104.8K');
    expect(fmt(7.5, { suffix: 'h' })).toBe('7.5h');
    expect(fmt(null, {})).toBe('–');
  });
  it('tiles summarise the latest non-null value', () => {
    const d = { ...base, series: [{ id: 's', name: 'Spend', values: [1, 2, null] }] } as any;
    expect(latest(d)).toMatchObject({ value: 2, label: 'b' });
    expect(summarize({ kind: 'chart', data: { ...d, prefix: '$' } } as any)).toEqual({ stat: '$2', label: 'Spend · b' });
  });
});

describe('agents create charts over MCP', () => {
  let pg: PGlite;
  let token: string;
  beforeEach(async () => {
    pg = await freshDb();
    token = await mintToken(pg);
  });
  it('create_slate with kind chart, then patch a series by id', async () => {
    const call = (name: string, args: object) =>
      handleRpc(tokenCaller(pg, token), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any) as Promise<any>;
    const kinds = (await call('describe_kinds', {})).result.structuredContent;
    expect(kinds.chart.collection).toBe('series');
    const c = await call('create_slate', { title: 'Spend', kind: 'chart', data: base, category: 'Money' });
    expect(c.result.isError).toBe(false);
    const p = await call('patch_items', { slug: 'spend', upsert: [{ id: 's', values: [3, 2, 1] }] });
    expect(p.result.structuredContent.data.series[0].values).toEqual([3, 2, 1]);
    const bad = await call('patch_items', { slug: 'spend', upsert: [{ id: 's', values: [1] }] });
    expect(bad.result.isError).toBe(true);
  });
});
