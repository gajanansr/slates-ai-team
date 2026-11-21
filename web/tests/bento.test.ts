import { describe, expect, it } from 'vitest';
import { metricBlocks } from '@/components/bento';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, label: `M${i}`, value: String(i) }));
const spans = (n: number, feature: boolean) => metricBlocks('x', items(n), { featureFirst: feature }).map((b: any) => b.span);
const cols = (s: string, wide: boolean) => {
  const m = wide ? s.match(/md:col-span-(\d)/) : s.match(/(?:^| )col-span-(\d)/);
  return Number(m?.[1]);
};
const rowsFill = (n: number, feature: boolean, wide: boolean) => spans(n, feature).reduce((a, s) => a + cols(s, wide), 0) % (wide ? 4 : 2) === 0;

describe('bento metric tiles leave no holes', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    for (const f of [true, false]) {
      it(`${n} tiles, feature=${f}: rows fill on phones and wide screens`, () => {
        expect(rowsFill(n, f, false)).toBe(true);
        expect(rowsFill(n, f, true)).toBe(true);
      });
    }
  }
  it('two tiles with a feature: feature 2 + last stretched to 2 on wide screens', () => {
    expect(spans(2, true)).toEqual(['col-span-2 md:col-span-2', 'col-span-2 md:col-span-2']);
  });
});
