import type { Note } from '@/lib/kinds';
import { firstLine } from '@/lib/summary';

const plain = (l: string) => firstLine(l);

/** Client-safe note helpers (no server imports). */
export const notePath = (id: string) => `/notes/${encodeURIComponent(id)}`;

/** A preview of the note's text: body lines (headings skipped when there is anything else), joined. */
export function snippet(body: string, max = 160) {
  const lines = body.split('\n').filter((l) => l.trim());
  const text = lines.filter((l) => !/^\s*#/.test(l)).map(plain).filter(Boolean);
  const line = (text.length ? text : lines.map(plain).filter(Boolean)).join(' · ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Pinned first, then most recently edited. */
export function sortNotes(items: Note[]) {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
}
