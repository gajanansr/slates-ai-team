import { slates, type Caller } from '@/lib/slates';
import { parseManifest } from '@/lib/studio/build';

/**
 * Agent Studio's daily limit (5 builds per user per rolling 24 hours), counted from what the
 * owner's own data already records, so it needs no table: every attempt logs one activity line,
 * and every agent's manifest board carries its last build time. The larger count wins.
 */
export const DAILY_BUILDS = 5;
export const BUILD_LOG = 'Agent Studio built';
export const BUILD_FAILED_LOG = 'Agent Studio could not build an agent';

export async function buildsInLastDay(c: Caller, now = Date.now()): Promise<number> {
  const since = now - 86_400_000;
  const [activity, all] = await Promise.all([slates.activity(c, 200).catch(() => []), slates.list(c).catch(() => [])]);
  const logged = activity.filter((a) => new Date(a.created_at).getTime() >= since && typeof a.summary === 'string' && (a.summary.startsWith(BUILD_LOG) || a.summary.startsWith(BUILD_FAILED_LOG))).length;
  const manifests = all.map(parseManifest).filter((m) => m && new Date(m.updated_at).getTime() >= since).length;
  return Math.max(logged, manifests);
}
