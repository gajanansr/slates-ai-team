'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Activity, AlarmClock, ArrowLeft, ArrowRight, Bot, Inbox, Layers, NotebookPen, Phone, Plus, Search, Settings2, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import { BoardIcon } from '@/components/board-icon';
import { savePins } from '@/app/(app)/actions';
import { searchEverything } from '@/app/(app)/feature-actions';
import { MAX_PINS, pinKey, type Pin, type ResolvedPin } from '@/lib/app-layout';
import type { Hit } from '@/lib/search';

export type LauncherData = {
  pins: ResolvedPin[];
  boards: { slug: string; title: string; icon: string | null; kind: string }[];
  notes: { id: string; title: string }[];
  inbox: number;
  due: number;
  admin: boolean;
};

const FEATURES = [
  { href: '/notes', label: 'Notes', Icon: NotebookPen, badge: null },
  { href: '/reminders', label: 'Reminders', Icon: AlarmClock, badge: 'due' },
  { href: '/inbox', label: 'Inbox', Icon: Inbox, badge: 'inbox' },
  { href: '/spaces', label: 'Spaces', Icon: Layers, badge: null },
] as const;
const MORE = [
  { href: '/call', label: 'Call Slates', Icon: Phone },
  { href: '/agents/studio', label: 'New agent', Icon: Sparkles },
  { href: '/agents', label: 'Agents', Icon: Bot },
  { href: '/activity', label: 'Activity', Icon: Activity },
  { href: '/settings/automations', label: 'Automations', Icon: Zap },
  { href: '/settings', label: 'Settings', Icon: Settings2 },
];

function PinIcon({ p, className }: { p: Pick<ResolvedPin, 'icon' | 'kind'>; className: string }) {
  return p.kind === 'notes' ? <NotebookPen className={className} strokeWidth={1.6} /> : <BoardIcon name={p.icon} kind={p.kind as any} className={className} />;
}

/**
 * The Apps sheet. On top, the features everyone has, always in the same place. Under the dashed
 * line, your own shortcuts: any board or note, one tap away. Search covers all of it.
 */
export function Launcher({ data, open, onClose }: { data: LauncherData; open: boolean; onClose: () => void }) {
  const [pins, setPins] = useState(data.pins);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // the shortcut being moved in Edit
  const [error, setError] = useState('');
  const [, start] = useTransition();
  const seq = useRef(0);
  useEffect(() => setPins(data.pins), [data.pins]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  useEffect(() => {
    if (open) return;
    setQ('');
    setEditing(false);
    setAdding(false);
    setPicked(null);
    setError('');
  }, [open]);

  // Titles match at once from what the sheet already has; text inside boards and notes follows from the server.
  const term = q.trim().toLowerCase();
  useEffect(() => {
    setHits([]);
    if (term.length < 2 || adding) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const found = await searchEverything(term).catch(() => []);
      if (mine === seq.current) setHits(found);
    }, 220);
    return () => clearTimeout(t);
  }, [term, adding]);

  const all = useMemo(
    () => [
      ...data.boards.map((b) => ({ key: `b:${b.slug}`, pin: { type: 'board', slug: b.slug } as Pin, href: `/s/${b.slug}`, title: b.title, icon: b.icon, kind: b.kind })),
      ...data.notes.map((n) => ({ key: `n:${n.id}`, pin: { type: 'note', id: n.id } as Pin, href: `/notes/${encodeURIComponent(n.id)}`, title: n.title, icon: null, kind: 'notes' })),
    ],
    [data.boards, data.notes],
  );

  if (!open) return null;

  const save = (next: ResolvedPin[]) => {
    const before = pins;
    setPins(next);
    setError('');
    start(async () => {
      const r = await savePins(next.map((p) => p.pin));
      if (!r.ok) {
        setPins(before);
        setError(r.error);
      }
    });
  };
  const move = (key: string, by: -1 | 1) => {
    const i = pins.findIndex((p) => p.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= pins.length) return;
    const next = [...pins];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const pickedAt = pins.findIndex((p) => p.key === picked);
  const pinned = new Set(pins.map((p) => pinKey(p.pin)));
  const full = pins.length >= MAX_PINS;
  const local = term ? all.filter((x) => x.title.toLowerCase().includes(term)) : [];
  const features = term ? [...FEATURES, ...MORE, ...(data.admin ? [{ href: '/admin', label: 'Admin', Icon: ShieldCheck }] : [])].filter((f) => f.label.toLowerCase().includes(term)) : [];
  const deep = hits.filter((h) => !local.some((l) => l.href === h.href && h.kind !== 'item')).slice(0, 8);
  const row = 'flex items-center gap-3 rounded-2xl px-2.5 py-2 active:bg-muted';
  const tile = 'grid size-14 place-items-center rounded-[20px] bg-muted text-fg';

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Apps">
      <button type="button" aria-label="Close" onClick={onClose} className="launcher-backdrop absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className="launcher-panel glass-strong absolute inset-x-4 bottom-[calc(var(--tabbar-h)+22px+var(--safe-bottom))] mx-auto flex max-h-[min(74dvh,620px)] max-w-sm flex-col rounded-[28px] p-4">
        <label className="mb-3 flex h-11 flex-none items-center gap-2 rounded-full bg-muted px-3.5">
          <Search className="size-4 flex-none text-fg-3" strokeWidth={1.8} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={adding ? 'Find a board to add' : 'Search boards and notes'} aria-label="Search" enterKeyHint="search" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-4" />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="grid size-7 flex-none place-items-center rounded-full text-fg-3">
              <X className="size-4" />
            </button>
          )}
        </label>

        <div className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
          {adding ? (
            <>
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="kicker">Add a shortcut</p>
                <button type="button" onClick={() => { setAdding(false); setQ(''); }} className="py-1 text-[13px] font-medium text-fg-2">Done</button>
              </div>
              <ul>
                {(term ? local : all).filter((x) => x.pin.type === 'board' && !pinned.has(x.key)).slice(0, 40).map((x) => (
                  <li key={x.key}>
                    <button type="button" disabled={full} onClick={() => save([...pins, x])} className={`${row} w-full text-left disabled:opacity-40`}>
                      <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2"><PinIcon p={x} className="size-4" /></span>
                      <span className="min-w-0 flex-1 truncate text-[15px]">{x.title}</span>
                      <Plus className="size-4 flex-none text-fg-3" />
                    </button>
                  </li>
                ))}
              </ul>
              {full && <p className="px-1 pt-2 text-[13px] text-fg-3">That is {MAX_PINS} shortcuts, the most that fit. Remove one to add another.</p>}
            </>
          ) : term ? (
            <ul>
              {features.map((f) => (
                <li key={f.href}>
                  <Link href={f.href} prefetch onClick={onClose} className={row}>
                    <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2"><f.Icon className="size-4" strokeWidth={1.7} /></span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{f.label}</span>
                  </Link>
                </li>
              ))}
              {local.slice(0, 12).map((x) => (
                <li key={x.key}>
                  <Link href={x.href} prefetch onClick={onClose} className={row}>
                    <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2"><PinIcon p={x} className="size-4" /></span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{x.title}</span>
                    <span className="flex-none text-[12px] text-fg-4">{x.kind === 'notes' ? 'Note' : 'Board'}</span>
                  </Link>
                </li>
              ))}
              {deep.map((h, i) => (
                <li key={`${h.href}-${i}`}>
                  <Link href={h.href} onClick={onClose} className={row}>
                    <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2"><Search className="size-4" strokeWidth={1.7} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{h.title}</span>
                      <span className="block truncate text-[12px] text-fg-3">{h.sub}</span>
                    </span>
                  </Link>
                </li>
              ))}
              {features.length + local.length + deep.length === 0 && <li className="px-2 py-3 text-[14px] text-fg-3">{term.length < 2 ? 'Keep typing…' : `Nothing found for “${q.trim()}”.`}</li>}
            </ul>
          ) : (
            <>
              <ul className="grid grid-cols-4 gap-x-2 pt-2">
                {FEATURES.map((f, i) => {
                  const n = f.badge === 'inbox' ? data.inbox : f.badge === 'due' ? data.due : 0;
                  return (
                    <li key={f.href} className="launcher-item" style={{ animationDelay: `${40 + i * 28}ms` }}>
                      <Link href={f.href} prefetch onClick={onClose} className="flex flex-col items-center gap-1.5 active:scale-95">
                        <span className={`relative ${tile}`}>
                          <f.Icon className="size-6" strokeWidth={1.6} />
                          {n > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-on-accent" aria-label={`${n} waiting`}>{n > 99 ? '99+' : n}</span>}
                        </span>
                        <span className="w-full truncate text-center text-[11.5px] text-fg-2">{f.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {[...MORE, ...(data.admin ? [{ href: '/admin', label: 'Admin', Icon: ShieldCheck }] : [])].map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} prefetch onClick={onClose} className="flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-[12.5px] text-fg-2 active:scale-95">
                      <m.Icon className="size-3.5" strokeWidth={1.7} /> {m.label}
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="mb-3 mt-4 flex items-center gap-2.5">
                <span className="kicker flex-none">Shortcuts</span>
                <span aria-hidden className="h-px min-w-0 flex-1 border-t border-dashed border-fg-4" />
                {pins.length > 0 && (
                  <button type="button" onClick={() => { setEditing((v) => !v); setPicked(null); }} className="flex-none py-1 text-[13px] font-medium text-fg-2">
                    {editing ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>
              <ul className="grid grid-cols-4 gap-x-2 gap-y-4 pb-1 pt-1.5">
                {pins.map((p, i) => (
                  <li key={p.key} className="launcher-item" style={{ animationDelay: `${150 + Math.min(i, 10) * 24}ms` }}>
                    {editing ? (
                      <button type="button" onClick={() => setPicked(picked === p.key ? null : p.key)} aria-pressed={picked === p.key} aria-label={`Select ${p.title}`} className="flex w-full flex-col items-center gap-1.5 active:scale-95">
                        <span className={`grid size-14 place-items-center rounded-[20px] transition-colors ${picked === p.key ? 'bg-tab-active text-on-tab-active' : 'bg-muted text-fg'}`}>
                          <PinIcon p={p} className="size-6" />
                        </span>
                        <span className="w-full truncate text-center text-[11.5px] text-fg-2">{p.title}</span>
                      </button>
                    ) : (
                      <Link href={p.href} prefetch onClick={onClose} className="flex flex-col items-center gap-1.5 active:scale-95">
                        <span className={tile}><PinIcon p={p} className="size-6" /></span>
                        <span className="w-full truncate text-center text-[11.5px] text-fg-2">{p.title}</span>
                      </Link>
                    )}
                  </li>
                ))}
                {!full && (
                  <li className="launcher-item" style={{ animationDelay: `${150 + Math.min(pins.length, 10) * 24}ms` }}>
                    <button type="button" onClick={() => { setAdding(true); setEditing(false); }} className="flex w-full flex-col items-center gap-1.5 active:scale-95">
                      <span className="grid size-14 place-items-center rounded-[20px] border border-dashed border-fg-4 text-fg-3"><Plus className="size-5" strokeWidth={1.6} /></span>
                      <span className="w-full truncate text-center text-[11.5px] text-fg-3">Add</span>
                    </button>
                  </li>
                )}
              </ul>
              {pins.length === 0 && <p className="pt-1 text-[13px] text-fg-3">Put the boards and notes you open most here.</p>}
              {editing &&
                (pickedAt >= 0 ? (
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={pickedAt === 0} onClick={() => move(picked!, -1)} className="btn btn-glass h-10 flex-1 text-[13.5px] disabled:opacity-40"><ArrowLeft className="size-4" /> Earlier</button>
                    <button type="button" disabled={pickedAt === pins.length - 1} onClick={() => move(picked!, 1)} className="btn btn-glass h-10 flex-1 text-[13.5px] disabled:opacity-40">Later <ArrowRight className="size-4" /></button>
                    <button type="button" onClick={() => { save(pins.filter((x) => x.key !== picked)); setPicked(null); }} className="btn btn-glass h-10 flex-1 text-[13.5px]"><X className="size-4" /> Remove</button>
                  </div>
                ) : (
                  <p className="mt-3 text-[13px] text-fg-3">Tap a shortcut to move or remove it.</p>
                ))}
            </>
          )}
          {error && <p className="px-1 pt-2 text-sm text-fg">{error}</p>}
        </div>
      </div>
    </div>
  );
}
