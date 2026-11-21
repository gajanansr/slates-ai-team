'use client';
import { useState, useTransition } from 'react';
import { Archive, ArrowDown, ArrowUp, Eye, EyeOff, FolderInput, Globe, Grip, History, Loader2, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { HistorySheet } from '@/components/slate/history-sheet';
import { ShareSheet } from '@/components/slate/share-sheet';
import { Sheet } from '@/components/ui/sheet';
import { archiveSlate, deleteSlate, moveSlate, setCategory, setFlag, setIcon, toggleShortcut } from '@/app/(app)/actions';
import { ICONS, BoardIcon } from '@/components/board-icon';
import { ICON_NAMES } from '@/lib/icons';
import type { Slate } from '@/lib/kinds';
import { offerUndo } from '@/lib/undo';

export function SlateActions({ slate, categories = [], shortcut }: { slate: Slate; categories?: string[]; shortcut?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategoryValue] = useState(slate.category ?? '');
  const [pending, start] = useTransition();
  const [sub, setSub] = useState<'history' | 'share' | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string } | undefined | void>, close = true) =>
    start(async () => {
      setError('');
      const r = await fn();
      if (r && !r.ok) setError(r.error ?? 'Something went wrong');
      else if (close) setOpen(false);
    });

  const Row = ({ icon: Icon, label, onClick, strong }: { icon: typeof Pin; label: string; onClick: () => void; strong?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`flex h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] transition-colors active:bg-muted ${
        strong ? 'text-fg' : 'text-fg-2'
      } hover:bg-muted`}
    >
      <Icon className="size-[18px]" strokeWidth={1.6} />
      {label}
    </button>
  );

  return (
    <>
      <button
        type="button"
        className="btn btn-glass btn-icon"
        aria-label={slate.pinned ? 'Unpin' : 'Pin'}
        aria-pressed={slate.pinned}
        onClick={() => act(() => setFlag(slate.slug, 'pinned', !slate.pinned), false)}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : slate.pinned ? <PinOff className="size-4" strokeWidth={1.75} /> : <Pin className="size-4" strokeWidth={1.75} />}
      </button>
      <button type="button" className="btn btn-glass btn-icon" aria-label="More actions" onClick={() => setOpen(true)}>
        <MoreHorizontal className="size-4" />
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirmDelete(false);
        }}
        title={slate.title}
      >
        <div className="space-y-1">
          <form
            className="mb-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => setCategory(slate.slug, category));
            }}
          >
            <FolderInput className="ml-3 size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <input
              className="field h-11"
              list="slate-categories"
              placeholder="Space, e.g. Money"
              value={category}
              onChange={(e) => setCategoryValue(e.target.value)}
              maxLength={40}
              aria-label="Space"
              enterKeyHint="done"
            />
            <datalist id="slate-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button className="btn btn-glass h-11" disabled={pending || category.trim() === (slate.category ?? '')}>
              Move
            </button>
          </form>
          <details className="group mb-2 rounded-2xl bg-muted/60">
            <summary className="flex h-12 cursor-pointer list-none items-center gap-3 px-3 text-[15px] text-fg-2">
              <BoardIcon name={slate.icon} kind={slate.kind} className="size-[18px]" />
              Icon
              <span className="ml-auto text-xs text-fg-3">{slate.icon ?? 'default'}</span>
            </summary>
            <div className="grid grid-cols-8 gap-1 px-2 pb-3" role="radiogroup" aria-label="Board icon">
              <button
                type="button"
                role="radio"
                aria-checked={!slate.icon}
                aria-label="Default icon"
                onClick={() => act(() => setIcon(slate.slug, null), false)}
                className={`grid aspect-square place-items-center rounded-xl text-[10px] font-medium ${!slate.icon ? 'bg-btn text-on-btn' : 'text-fg-3 active:bg-surface'}`}
              >
                Auto
              </button>
              {ICON_NAMES.map((name) => {
                const I = ICONS[name];
                const on = slate.icon === name;
                return (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={name}
                    title={name}
                    onClick={() => act(() => setIcon(slate.slug, name), false)}
                    className={`grid aspect-square place-items-center rounded-xl transition-colors ${on ? 'bg-btn text-on-btn' : 'text-fg-2 active:bg-surface'}`}
                  >
                    <I className="size-[18px]" strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>
          </details>
          {shortcut !== undefined && <Row icon={Grip} label={shortcut ? 'Remove from shortcuts' : 'Add to shortcuts'} onClick={() => act(() => toggleShortcut({ type: 'board', slug: slate.slug }))} />}
          <Row icon={History} label="History & undo" onClick={() => { setOpen(false); setSub('history'); }} />
          <Row icon={Globe} label={slate.share_token ? 'Public link · on' : 'Public link'} onClick={() => { setOpen(false); setSub('share'); }} />
          <Row icon={ArrowUp} label="Move up" onClick={() => act(() => moveSlate(slate.slug, -1))} />
          <Row icon={ArrowDown} label="Move down" onClick={() => act(() => moveSlate(slate.slug, 1))} />
          <Row
            icon={slate.hidden ? Eye : EyeOff}
            label={slate.hidden ? 'Show on home' : 'Hide from home'}
            onClick={() => act(() => setFlag(slate.slug, 'hidden', !slate.hidden))}
          />
          <Row icon={Archive} label="Archive" onClick={() => { offerUndo({ label: `${slate.title} archived`, undo: { type: 'unarchive', slug: slate.slug } }); act(() => archiveSlate(slate.slug)); }} />
          <div className="my-2 h-px bg-muted" />
          {confirmDelete ? (
            <div className="rounded-2xl border border-line p-3">
              <p className="mb-3 text-sm text-fg-2">Delete “{slate.title}” permanently? Archive keeps it restorable.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-glass flex-1" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary flex-1" disabled={pending} onClick={() => act(() => deleteSlate(slate.slug))}>
                  {pending && <Loader2 className="size-4 animate-spin" />} Delete
                </button>
              </div>
            </div>
          ) : (
            <Row icon={Trash2} label="Delete…" strong onClick={() => setConfirmDelete(true)} />
          )}
          {error && <p className="px-3 pt-2 text-sm text-fg">{error}</p>}
        </div>
      </Sheet>
      <HistorySheet slug={slate.slug} open={sub === 'history'} onClose={() => setSub(null)} />
      <ShareSheet slug={slate.slug} token={slate.share_token ?? null} open={sub === 'share'} onClose={() => setSub(null)} />
    </>
  );
}
