/**
 * The only icons a board may use (agents and users pick by name). Monoline Lucide
 * glyphs that match the app; emojis are not accepted anywhere.
 */
export const ICON_NAMES = [
  'wallet', 'credit-card', 'bank', 'receipt', 'piggy-bank', 'chart-bar', 'chart-line', 'target',
  'briefcase', 'building', 'package', 'code', 'bot', 'idea', 'rocket', 'bolt',
  'calendar', 'clock', 'bell', 'checklist', 'flag', 'trophy', 'star', 'sparkles',
  'home', 'cart', 'food', 'coffee', 'gift', 'tag', 'car', 'plane', 'globe', 'map-pin',
  'heart', 'health', 'pill', 'dumbbell', 'activity', 'brain', 'leaf', 'sun', 'moon',
  'book', 'graduation', 'news', 'file', 'folder', 'link', 'mail', 'phone', 'people',
  'music', 'film', 'camera', 'game', 'palette', 'shield',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
export const isIconName = (v: unknown): v is IconName => typeof v === 'string' && (ICON_NAMES as readonly string[]).includes(v);
