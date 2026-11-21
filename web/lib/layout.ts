import { DASHBOARD_LOOKS, WIDGET_SIZES, WIDGET_VIEWS } from '@/lib/kinds';

export type LayoutWidgetPatch = {
  id: string;
  size?: (typeof WIDGET_SIZES)[number] | null;
  view?: (typeof WIDGET_VIEWS)[number] | null;
  hidden?: boolean | null;
  section?: string | null;
};
export type LayoutPatch = {
  look?: (typeof DASHBOARD_LOOKS)[number] | null;
  /** Widget ids in the order they should appear. Widgets not listed keep their order after the listed ones. */
  order?: string[];
  widgets?: LayoutWidgetPatch[];
};

/** Which views make sense for which widget kind (the picker and the validator share this). */
export const VIEWS_BY_KIND: Record<string, readonly (typeof WIDGET_VIEWS)[number][]> = {
  goals: ['auto', 'ring', 'bars', 'compact'],
  habits: ['auto', 'ring', 'heatmap', 'dots'],
  countdown: ['auto', 'compact'],
  tracker: ['auto', 'compact'],
  list: ['auto', 'compact'],
};

/** Apply a layout patch to dashboard data. Pure: returns new data and never touches widget content. */
export function applyLayout(data: any, patch: LayoutPatch): any {
  const widgets: any[] = [...(data?.widgets ?? [])];
  const known = new Set(widgets.map((w) => w.id));
  for (const id of patch.order ?? []) if (!known.has(id)) throw new Error(`Unknown widget id "${id}"`);
  for (const w of patch.widgets ?? []) if (!known.has(w.id)) throw new Error(`Unknown widget id "${w.id}"`);

  let next = widgets;
  if (patch.order?.length) {
    const pos = new Map(patch.order.map((id, i) => [id, i] as const));
    const listed = widgets.filter((w) => pos.has(w.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    const rest = widgets.filter((w) => !pos.has(w.id));
    next = [...listed, ...rest];
  }
  const by = new Map((patch.widgets ?? []).map((w) => [w.id, w] as const));
  next = next.map((w) => {
    const p = by.get(w.id);
    if (!p) return w;
    const out = { ...w };
    for (const key of ['size', 'view', 'hidden', 'section'] as const) {
      if (!(key in p)) continue;
      const v = p[key];
      // null / "auto" / false mean "back to the default": drop the field.
      if (v === null || v === undefined || (key === 'view' && v === 'auto') || (key === 'hidden' && v === false) || (key === 'section' && v === '')) delete out[key];
      else out[key] = v;
    }
    return out;
  });
  const out = { ...data, widgets: next };
  if ('look' in patch) {
    if (!patch.look || patch.look === 'cards') delete out.look;
    else out.look = patch.look;
  }
  return out;
}
