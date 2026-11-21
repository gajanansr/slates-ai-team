/**
 * Custom palette: one accent colour in, a full light + dark colour set out. The hue tints the page,
 * cards and text; the accent itself is nudged only as far as needed so text stays readable
 * (body text 7:1 on pages, accent text 4.5:1, the label on the accent 4.5:1).
 * Pure functions, no DOM, so agents' settings and the picker share one result.
 */
export const HEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_CUSTOM = '#6d8cff';

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hsl(h: number, s: number, l: number): string {
  s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
function lum(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Move lightness (towards `dir`) until `fg` reaches `min` contrast against `bg`. */
function reach(h: number, s: number, l: number, bg: string, min: number, dir: 1 | -1): string {
  let c = hsl(h, s, l);
  for (let i = 0; i < 100 && contrast(c, bg) < min; i++) {
    l += dir * 0.01;
    c = hsl(h, s, l);
  }
  return c;
}
const rgba = (hex: string, a: number) => `rgb(${toRgb(hex).join(' ')} / ${a})`;

/** HSV <-> hex, for the colour wheel (h 0-360, s and v 0-1). */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(5) + f(3) + f(1);
}
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(HEX.test(hex) ? hex : DEFAULT_CUSTOM).map((x) => x / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}

export type CustomVars = Record<string, string>;
export type CustomPalette = { light: CustomVars; dark: CustomVars; swatch: { light: Swatch; dark: Swatch }; pages: { light: string; dark: string }; accent: string };
type Swatch = { page: string; surface: string; ink: string; accent: string; hero: string };

/** The label colour on an accent: dark or light tinted ink, whichever reads better. */
function onAccent(accent: string, h: number): string {
  const dark = hsl(h, 0.2, 0.1), light = hsl(h, 0.1, 0.97);
  const best = contrast(accent, dark) >= contrast(accent, light) ? dark : light;
  return contrast(accent, best) >= 4.5 ? best : lum(accent) > 0.18 ? '#000000' : '#ffffff';
}

export function makeCustomPalette(input: string): CustomPalette {
  const hex = HEX.test(input) ? input.toLowerCase() : DEFAULT_CUSTOM;
  const [h, s0] = toHsl(toRgb(hex));
  const s = Math.min(0.9, Math.max(0.35, s0));

  // Light
  const lPage = hsl(h, 0.14, 0.93), lSurface = hsl(h, 0.22, 0.98), lInk = hsl(h, 0.16, 0.14);
  const lAccent = hex;
  const lOn = onAccent(lAccent, h);
  const lOlive = reach(h, s, 0.5, lSurface, 4.5, -1);
  const light: CustomVars = {
    page: lPage, surface: lSurface, muted: hsl(h, 0.12, 0.92), sage: hsl(h, 0.16, 0.84), ink: lInk,
    'ink-2': reach(h, 0.07, 0.4, lPage, 7, -1), 'ink-3': reach(h, 0.05, 0.55, lPage, 3.5, -1), 'ink-4': reach(h, 0.04, 0.7, lPage, 2, -1),
    line: rgba(lInk, 0.08), hero: lInk, 'on-hero': lPage, 'on-hero-2': hsl(h, 0.06, 0.66), 'hero-chip': 'rgb(255 255 255 / 0.09)',
    accent: lAccent, 'on-accent': lOn, olive: lOlive, btn: lInk, 'on-btn': hsl(h, 0.1, 0.96),
    tab: lSurface, 'tab-active': lInk, 'on-tab-active': lPage, 'chart-hl': lOlive,
  };

  // Dark
  const dPage = hsl(h, 0.16, 0.065), dSurface = hsl(h, 0.15, 0.1), dInk = hsl(h, 0.1, 0.92);
  const [, , al] = toHsl(toRgb(hex));
  const dAccent = al < 0.62 ? hsl(h, s, 0.72) : hex;
  const dOn = onAccent(dAccent, h);
  const dOlive = reach(h, s, 0.7, dSurface, 4.5, 1);
  const dark: CustomVars = {
    page: dPage, surface: dSurface, muted: hsl(h, 0.13, 0.21), sage: hsl(h, 0.13, 0.145), ink: dInk,
    'ink-2': reach(h, 0.05, 0.72, dPage, 7, 1), 'ink-3': reach(h, 0.04, 0.55, dPage, 3.5, 1), 'ink-4': reach(h, 0.04, 0.38, dPage, 2, 1),
    line: rgba(dInk, 0.08), hero: hsl(h, 0.15, 0.125), 'on-hero': dInk, 'on-hero-2': reach(h, 0.05, 0.6, hsl(h, 0.15, 0.125), 4.5, 1), 'hero-chip': 'rgb(255 255 255 / 0.07)',
    accent: dAccent, 'on-accent': dOn, olive: dOlive, btn: dAccent, 'on-btn': dOn,
    tab: dSurface, 'tab-active': dAccent, 'on-tab-active': dOn, 'chart-hl': dAccent,
  };

  return {
    light, dark, accent: hex,
    pages: { light: lPage, dark: dPage },
    swatch: {
      light: { page: lPage, surface: lSurface, ink: lInk, accent: lAccent, hero: lInk },
      dark: { page: dPage, surface: dSurface, ink: dInk, accent: dAccent, hero: dark.hero },
    },
  };
}

const block = (sel: string, v: CustomVars) => `${sel}{${Object.entries(v).map(([k, x]) => `--${k}:${x}`).join(';')}}`;

/** CSS for both modes, keyed on <html data-palette="custom"> and data-theme, like the built-in palettes. */
export function customCss(p: CustomPalette): string {
  return block(":root[data-palette='custom']", p.light) + block(":root[data-palette='custom'][data-theme='dark']", p.dark);
}
