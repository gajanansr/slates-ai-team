import type { Note, Slate } from '@/lib/kinds';
import { notePath, snippet } from '@/lib/notes-shared';

/** Search across board titles, every item inside every board, notes and reminders. */
export type Hit = { kind: 'board' | 'item' | 'note' | 'reminder'; title: string; sub: string; href: string; score: number };

const norm = (s: string) => s.toLowerCase().normalize('NFKD');

/** Text fields of one board's items: [itemTitle, extraText]. */
function itemsOf(s: Slate): [string, string][] {
  const d = s.data as any;
  const out: [string, string][] = [];
  const add = (t: unknown, ...rest: unknown[]) => t && out.push([String(t), rest.filter(Boolean).join(' ')]);
  for (const it of d?.items ?? []) add(it.text ?? it.title ?? it.label ?? it.name, it.detail, it.meta, it.value, it.sub, it.url);
  for (const e of d?.entries ?? []) add(e.title ?? e.date, ...(e.items ?? []));
  for (const r of d?.rows ?? []) {
    const cells = Object.values(r.cells ?? {}) as string[];
    add(cells[0], ...cells.slice(1));
  }
  for (const w of d?.widgets ?? []) {
    add(w.title);
    for (const it of w.data?.items ?? []) add(it.text ?? it.title ?? it.label, it.detail, it.meta, it.value);
    for (const r of w.data?.rows ?? []) {
      const cells = Object.values(r.cells ?? {}) as string[];
      add(cells[0], ...cells.slice(1));
    }
  }
  if (typeof d?.body === 'string') add(d.body.split('\n').find((l: string) => l.trim()) ?? s.title, d.body);
  if (typeof d?.headline === 'string') add(d.headline);
  return out;
}

function score(q: string, title: string, rest = '') {
  const t = norm(title);
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 60;
  if (t.includes(q)) return 45;
  if (norm(rest).includes(q)) return 20;
  return 0;
}

export function searchAll(q: string, all: Slate[], notes: Note[] = [], reminders: { id: string; text: string; due_at: string }[] = [], limit = 30): Hit[] {
  const query = norm(q.trim());
  if (!query) return [];
  const hits: Hit[] = [];
  for (const s of all) {
    if (s.kind === 'notes') continue;
    const bs = score(query, s.title, s.category ?? '');
    if (bs) hits.push({ kind: 'board', title: s.title, sub: s.category ?? s.kind, href: `/s/${s.slug}`, score: bs + 5 });
    for (const [title, rest] of itemsOf(s)) {
      const sc = score(query, title, rest);
      if (sc) hits.push({ kind: 'item', title: title.slice(0, 140), sub: s.title, href: `/s/${s.slug}`, score: sc });
    }
  }
  for (const n of notes) {
    const sc = Math.max(score(query, n.title, `${n.body} ${(n.tags ?? []).join(' ')}`), (n.tags ?? []).some((t) => norm(t) === query) ? 70 : 0);
    if (sc) hits.push({ kind: 'note', title: n.title, sub: snippet(n.body) || 'Note', href: notePath(n.id), score: sc + 3 });
  }
  for (const r of reminders) {
    const sc = score(query, r.text);
    if (sc) hits.push({ kind: 'reminder', title: r.text, sub: new Date(r.due_at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }), href: '/reminders', score: sc });
  }
  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((h) => {
      const k = `${h.kind}|${h.title}|${h.href}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit);
}
