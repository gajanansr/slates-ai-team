import { describe, expect, it } from 'vitest';
import { HEX, contrast, customCss, makeCustomPalette } from '@/lib/custom-palette';
import { AppLayoutSchema, parseLayout } from '@/lib/app-layout';

const fromHsl = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
};

describe('custom palette', () => {
  it('keeps text readable for any accent, in light and dark', () => {
    for (let h = 0; h < 360; h += 15)
      for (const [s, l] of [[1, 0.5], [0.9, 0.3], [0.6, 0.8], [0.3, 0.5], [1, 0.95], [1, 0.08], [0, 0.5], [0, 1], [0, 0]]) {
        const input = fromHsl(h, s, l);
        const p = makeCustomPalette(input);
        for (const m of ['light', 'dark'] as const) {
          const v = p[m];
          const ok = (name: string, a: string, b: string, min: number) => expect(contrast(a, b), `${input} ${m} ${name}`).toBeGreaterThanOrEqual(min);
          ok('ink on page', v.ink, v.page, 7);
          ok('ink-2 on page', v['ink-2'], v.page, 7);
          ok('ink-3 on page', v['ink-3'], v.page, 3.5);
          ok('label on accent', v['on-accent'], v.accent, 4.5);
          ok('accent text on surface', v.olive, v.surface, 4.5);
          ok('on-btn on btn', v['on-btn'], v.btn, 4.5);
          ok('on-tab on tab-active', v['on-tab-active'], v['tab-active'], 4.5);
        }
      }
  });
  it('light mode keeps the exact accent the user picked', () => {
    expect(makeCustomPalette('#6d8cff').light.accent).toBe('#6d8cff');
  });
  it('falls back to a default for junk input and emits css for both modes', () => {
    const css = customCss(makeCustomPalette('nope'));
    expect(css).toContain(":root[data-palette='custom']{");
    expect(css).toContain(":root[data-palette='custom'][data-theme='dark']{");
    expect(css).toContain('--accent:');
  });
  it('the layout stores one accent, which wins over a named palette', () => {
    expect(HEX.test('#6d8cff')).toBe(true);
    expect(AppLayoutSchema.safeParse({ v: 1, accent: 'blue' }).success).toBe(false);
    expect(parseLayout({ v: 1, palette: 'ocean', accent: '#6D8CFF' })).toEqual({ v: 1, accent: '#6d8cff' });
    expect(parseLayout({ v: 1, palette: 'ocean' })).toEqual({ v: 1, palette: 'ocean' });
  });
});

import { hexToHsv, hsvToHex } from '@/lib/custom-palette';
describe('colour wheel maths', () => {
  it('round-trips hex through hsv', () => {
    for (const hex of ['#6d8cff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#123456', '#ffffff', '#1f2a26'])
      expect(hsvToHex(...hexToHsv(hex))).toBe(hex);
  });
  it('maps the wheel corners', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
    expect(hsvToHex(200, 0, 1)).toBe('#ffffff');
  });
});
