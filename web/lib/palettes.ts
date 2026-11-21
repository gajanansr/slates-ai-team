/**
 * Palettes: whole-app colour sets. Lime is the default (no attribute). The others are CSS variable sets in
 * globals.css under :root[data-palette='<id>'], generated from the default's lightness so contrast carries
 * over (text 7:1 on pages, accents 7:1 for their text, dimmed text at least 3:1; checked for light and dark).
 * Swatches here only draw the picker previews.
 */
export const PALETTE_IDS = ["lime", "ocean", "sunset", "lavender", "mono"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];
export const DEFAULT_PALETTE: PaletteId = 'lime';
export const PALETTE_KEY = 'slates-palette';

type Swatch = { page: string; surface: string; ink: string; accent: string; hero: string };
export const PALETTES: Record<PaletteId, { label: string; blurb: string; light: Swatch; dark: Swatch }> = {
  lime: { label: 'Lime', blurb: 'Fresh and bright. The classic Slates look.', light: { page: '#f1f2ec', surface: '#fbfbf8', ink: '#1f2a26', accent: '#e1f48a', hero: '#1f2a26' }, dark: { page: '#0d1210', surface: '#161d1a', ink: '#eceee7', accent: '#e1f48a', hero: '#1b2420' } },
  ocean: { label: 'Ocean', blurb: 'Cool blues, calm and clear.', light: { page: '#ecf0f2', surface: '#f8fafb', ink: '#1f262a', accent: '#9fdcf5', hero: '#1f262a' }, dark: { page: '#0d1012', surface: '#161b1d', ink: '#e7ecee', accent: '#8fd3f0', hero: '#1b2124' } },
  sunset: { label: 'Sunset', blurb: 'Warm peach and sand, easy on the eyes.', light: { page: '#f2eeec', surface: '#fbf9f8', ink: '#2a221f', accent: '#ffc7a1', hero: '#2a221f' }, dark: { page: '#120e0d', surface: '#1d1816', ink: '#eee9e7', accent: '#ffb98c', hero: '#241e1b' } },
  lavender: { label: 'Lavender', blurb: 'Soft violet, quiet and focused.', light: { page: '#eeecf2', surface: '#f9f8fb', ink: '#231f2a', accent: '#d6caff', hero: '#231f2a' }, dark: { page: '#0f0d12', surface: '#19161d', ink: '#eae7ee', accent: '#cbbcff', hero: '#1e1b24' } },
  mono: { label: 'Mono', blurb: 'Pure greys. No colour, all content.', light: { page: '#efefef', surface: '#fafafa', ink: '#242424', accent: '#d9d9d9', hero: '#242424' }, dark: { page: '#101010', surface: '#1a1a1a', ink: '#ebebeb', accent: '#ececec', hero: '#202020' } },
};

export const isPalette = (v: unknown): v is PaletteId => typeof v === 'string' && (PALETTE_IDS as readonly string[]).includes(v);
