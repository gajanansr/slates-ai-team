import type { Note, Slate } from '@/lib/kinds';
import { categorySlug, groupBoards } from '@/lib/summary';

/** Boards that are plumbing, not part of any space. */
export const SYSTEM_SLUGS = new Set(['inbox', 'desk']);
export const isSpaceBoard = (s: Slate) => !s.hidden && !s.archived_at && s.kind !== 'brief' && s.kind !== 'notes' && !SYSTEM_SLUGS.has(s.slug);

export type Space = { name: string; slug: string; boards: Slate[]; notes: Note[] };

/**
 * A space is an area of your life (Money, Work, Health). Boards join one by their category;
 * notes join by a tag with the same name. Boards without a category gather by what they are.
 */
export function spacesOf(all: Slate[], notes: Note[]): Space[] {
  const groups = groupBoards(all.filter(isSpaceBoard));
  const tagged = (slug: string) => notes.filter((n) => (n.tags ?? []).some((t) => categorySlug(t) === slug));
  return groups.map((g) => ({ ...g, notes: tagged(g.slug) }));
}
