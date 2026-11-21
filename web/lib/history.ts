import { exec, slates, SlatesError, type Caller } from '@/lib/slates';
import type { Slate } from '@/lib/kinds';

/**
 * History: every change to a board's data or title is snapshotted (newest 60 kept).
 * Restoring a version writes it back as a NEW version, so a restore can be undone too.
 */
const H = 'history_exec';

export type VersionInfo = { version: number; title: string; created_at: string; by: string; current: boolean };
export type Changes = { since: string; boards: { slug: string; title: string; changes: number; last_at: string; by: string[] }[] };

export const history = {
  versions: (c: Caller, slug: string, limit = 30) => exec<VersionInfo[]>(c, 'versions', { slug, limit }, H),
  version: (c: Caller, slug: string, version: number) =>
    exec<{ version: number; title: string; data: Record<string, unknown>; created_at: string; by: string; current_version: number } | null>(
      c,
      'version',
      { slug, version },
      H,
    ),
  series: (c: Caller, slug: string, limit = 30) => exec<{ version: number; at: string; data: any }[]>(c, 'series', { slug, limit }, H),
  changes: (c: Caller, since?: string) => exec<Changes>(c, 'changes', since ? { since } : {}, H),
  seen: (c: Caller) => exec<{ previous: string | null }>(c, 'seen', {}, H),

  async restore(c: Caller, slug: string, version: number): Promise<Slate> {
    const v = await history.version(c, slug, version);
    if (!v) throw new SlatesError(`No version ${version} of "${slug}". Use slate_history to list versions.`, 404, 'not_found');
    if (v.version === v.current_version) throw new SlatesError('That is already the current version.', 422, 'invalid');
    return slates.update(c, slug, {
      title: v.title,
      data: v.data,
      expected_version: v.current_version,
      note: `Restored version ${version} (from ${new Date(v.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    });
  },
};

/** "₹1,24,500" -> 124500, "58%" -> 58, "-₹24,500" -> -24500, "7 mo" -> 7. Non-numbers -> null. */
export function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.replace(/,/g, '').match(/(-)?[^\d-]*(\d+(?:\.\d+)?)\s*([kKmMlL]|cr|Cr)?/);
  if (!m) return null;
  const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, l: 1e5, L: 1e5, cr: 1e7, Cr: 1e7 }[m[3] ?? ''] ?? 1;
  const n = Number(m[2]) * mult * (m[1] ? -1 : 1);
  return Number.isFinite(n) ? n : null;
}

/**
 * Free trend lines: for every metric tile without an explicit `trend`, rebuild the
 * series from past versions. Keys are "itemId" (metrics boards) or "widgetId/itemId"
 * (metrics widgets inside a dashboard). Only consecutive distinct values are kept.
 */
export function metricTrends(series: { data: any }[], max = 12): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const push = (key: string, v: unknown) => {
    const n = numeric(v);
    if (n === null) return;
    const arr = (out[key] ??= []);
    if (arr[arr.length - 1] !== n) arr.push(n);
  };
  for (const { data } of series) {
    for (const m of data?.items ?? []) if (m?.id && 'value' in m) push(m.id, m.value);
    for (const w of data?.widgets ?? []) if (w?.kind === 'metrics') for (const m of w.data?.items ?? []) push(`${w.id}/${m.id}`, m.value);
  }
  for (const k of Object.keys(out)) {
    out[k] = out[k].slice(-max);
    if (out[k].length < 2) delete out[k];
  }
  return out;
}
