'use client';
import { useState, useTransition } from 'react';
import { DragHandle, useDragReorder } from '@/components/ui/drag-reorder';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, SlidersHorizontal } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { useReadOnly } from '@/components/readonly';
import { saveDashboardLayout } from '@/app/(app)/actions';
import { VIEWS_BY_KIND } from '@/lib/layout';

type W = { id: string; title: string; kind: string; size?: string; view?: string; hidden?: boolean; section?: string };
const SIZES: [string, string][] = [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'Full']];
const LOOKS: [string, string][] = [['cards', 'Cards'], ['compact', 'Compact'], ['focus', 'Focus']];

/** "You decide how your slates look": order, size, view and visibility for every widget. */
export function CustomizeDashboard({ slug, widgets: initial, look: initialLook, compact }: { slug: string; widgets: W[]; look?: string; compact?: boolean }) {
  const ro = useReadOnly();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<W[]>(initial);
  const [look, setLook] = useState(initialLook ?? 'cards');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const dnd = useDragReorder((from, to) =>
    setRows((r) => {
      const n = [...r];
      n.splice(to, 0, n.splice(from, 1)[0]);
      return n;
    }),
  );
  if (ro) return null;

  const reset = () => {
    setRows(initial);
    setLook(initialLook ?? 'cards');
    setError('');
  };
  const move = (i: number, d: number) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const set = (id: string, patch: Partial<W>) => setRows((r) => r.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const save = () =>
    start(async () => {
      setError('');
      const res = await saveDashboardLayout(slug, {
        look: look as any,
        order: rows.map((w) => w.id),
        widgets: rows.map((w) => ({ id: w.id, size: (w.size as any) ?? null, view: (w.view as any) ?? null, hidden: !!w.hidden, section: w.section ?? null })),
      });
      if (!res.ok) setError(res.error);
      else setOpen(false);
    });

  const chip = (on: boolean) => `h-9 min-w-9 rounded-full px-3 text-[13px] transition-colors ${on ? 'bg-btn text-on-btn' : 'bg-muted text-fg-2'}`;

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true); }}
        aria-label="Customize this dashboard"
        className={compact ? 'btn btn-glass btn-icon' : 'btn btn-glass h-10 gap-2 px-4 text-[14px]'}
      >
        <SlidersHorizontal className="size-4" strokeWidth={1.75} /> {!compact && 'Customize'}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Customize this dashboard">
        <div className="space-y-5">
          <fieldset>
            <legend className="kicker mb-2">Style</legend>
            <div className="flex gap-1.5">
              {LOOKS.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={look === v} onClick={() => setLook(v)} className={chip(look === v)}>
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          <ul ref={dnd.listRef} className="space-y-2.5">
            {rows.map((w, i) => {
              const views = VIEWS_BY_KIND[w.kind];
              return (
                <li key={w.id} className={`rounded-2xl border p-3 ${dnd.active === i ? 'border-fg bg-muted' : 'border-line'} ${w.hidden ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-2">
                    <DragHandle label={w.title} active={dnd.active === i} onPointerDown={dnd.start(i)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium">{w.title}</span>
                      <span className="block text-[12px] text-fg-4">{w.kind}</span>
                    </span>
                    <button type="button" aria-label={`Move ${w.title} up`} disabled={i === 0} onClick={() => move(i, -1)} className="grid size-9 place-items-center rounded-full bg-muted disabled:opacity-30">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" aria-label={`Move ${w.title} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="grid size-9 place-items-center rounded-full bg-muted disabled:opacity-30">
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" aria-label={w.hidden ? `Show ${w.title}` : `Hide ${w.title}`} aria-pressed={!!w.hidden} onClick={() => set(w.id, { hidden: !w.hidden })} className="grid size-9 place-items-center rounded-full bg-muted">
                      {w.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] text-fg-4">Size</span>
                    <button type="button" aria-pressed={!w.size} onClick={() => set(w.id, { size: undefined })} className={chip(!w.size)}>Auto</button>
                    {SIZES.map(([v, l]) => (
                      <button key={v} type="button" aria-pressed={w.size === v} onClick={() => set(w.id, { size: v })} className={chip(w.size === v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {views && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[12px] text-fg-4">View</span>
                      {views.map((v) => {
                        const on = (w.view ?? 'auto') === v;
                        return (
                          <button key={v} type="button" aria-pressed={on} onClick={() => set(w.id, { view: v === 'auto' ? undefined : v })} className={chip(on)}>
                            {v === 'auto' ? 'Auto' : v[0].toUpperCase() + v.slice(1)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {error && <p className="text-sm text-fg-2">{error}</p>}
          <button type="button" onClick={save} disabled={pending} className="btn btn-primary w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : 'Save layout'}
          </button>
        </div>
      </Sheet>
    </>
  );
}
