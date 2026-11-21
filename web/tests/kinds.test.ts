import { describe, expect, it } from 'vitest';
import { describeKinds, EXAMPLES, patchCollection, SLATE_KINDS, validateData } from '@/lib/kinds';

describe('kind schemas', () => {
  it('every example validates', () => {
    for (const k of SLATE_KINDS) expect(() => validateData(k, EXAMPLES[k]), k).not.toThrow();
  });
  it('rejects wrong shapes with a readable message', () => {
    expect(() => validateData('links', { items: [{ id: 'a', title: 'x', url: 'not a url' }] })).toThrow(/Invalid data for kind "links"/);
    expect(() => validateData('list', { items: [{ text: 'no id' }] })).toThrow();
    expect(() => validateData('metrics', { items: [{ id: 'a', label: 'x', value: '1', progress: 140 }] })).toThrow();
  });
  it('rejects duplicate ids', () => {
    expect(() => validateData('list', { items: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] })).toThrow(/Duplicate/);
  });
  it('rejects javascript: links', () => {
    expect(() => validateData('links', { items: [{ id: 'a', title: 'x', url: 'javascript:alert(1)' }] })).toThrow();
  });
  it('describes every kind as JSON schema', () => {
    const d = describeKinds();
    expect(Object.keys(d)).toEqual(SLATE_KINDS);
    expect(d.table.collection).toBe('rows');
    expect(d.list.schema).toHaveProperty('properties.items');
  });
});

describe('patchCollection', () => {
  const base = { items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
  it('merges by id, appends new, removes', () => {
    const out = patchCollection('list', base, { upsert: [{ id: 'a', done: true }, { id: 'c', text: 'C' }], remove: ['b'] });
    expect(out.items).toEqual([{ id: 'a', text: 'A', done: true }, { id: 'c', text: 'C' }]);
  });
  it('prepends when asked', () => {
    const out = patchCollection('list', base, { upsert: [{ id: 'z', text: 'Z' }], prepend: true });
    expect((out.items as { id: string }[]).map((i) => i.id)).toEqual(['z', 'a', 'b']);
  });
  it('merges table cells instead of replacing them', () => {
    const t = { columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ id: 'r', cells: { a: '1', b: '2' } }] };
    const out = patchCollection('table', t, { upsert: [{ id: 'r', cells: { b: '3' } }] });
    expect(out.rows).toEqual([{ id: 'r', cells: { a: '1', b: '3' } }]);
  });
  it('refuses markdown and items without ids', () => {
    expect(() => patchCollection('markdown', { body: '' }, { upsert: [{ id: 'x' }] })).toThrow();
    expect(() => patchCollection('list', base, { upsert: [{ text: 'no id' }] })).toThrow();
  });
});
