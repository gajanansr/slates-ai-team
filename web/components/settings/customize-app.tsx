'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Check, ChevronRight, Loader2, Plus, X } from 'lucide-react';
import { NavBar } from '@/components/slate/nav-bar';
import { PalettePicker, type PaletteChoice } from '@/components/settings/palette-picker';
import { DEFAULT_CUSTOM } from '@/lib/custom-palette';
import { applyPalette } from '@/lib/theme';
import { DEFAULT_PALETTE } from '@/lib/palettes';
import { saveAppLayout } from '@/app/(app)/actions';
import { DEFAULT_SHORTCUTS, DEFAULT_TABS, MAX_SHORTCUTS, ROUTE_TABS, placesFor, resolveShortcuts, resolveTabs, type AppLayout, type Tab } from '@/lib/app-layout';

type Board = { slug: string; title: string; icon: string | null; kind: string };
const keyOf = (t: Tab) => (t.type === 'route' ? `r:${t.id}` : `b:${t.slug}`);
const fromKey = (k: string): Tab => (k.startsWith('r:') ? { type: 'route', id: k.slice(2) as any } : { type: 'board', slug: k.slice(2) });

/** Settings, Customize app: three fixed tabs, plus the shortcuts the Apps button opens. */
export function CustomizeApp({ layout, boards, admin = false }: { layout: AppLayout; boards: Board[]; admin?: boolean }) {
  const initTabs = layout.tabs ?? DEFAULT_TABS;
  const initShort = layout.shortcuts ?? DEFAULT_SHORTCUTS;
  const [tabs, setTabs] = useState<Tab[]>(initTabs);
  const [shortcuts, setShortcuts] = useState<Tab[]>(initShort);
  const start0: PaletteChoice = layout.accent ? 'custom' : layout.palette ?? DEFAULT_PALETTE;
  const [palette, setPalette] = useState<PaletteChoice>(start0);
  const [accent, setAccent] = useState(layout.accent ?? DEFAULT_CUSTOM);
  const [editing, setEditing] = useState(false); // colour wheel open
  const saved = useRef({ palette: start0, accent: layout.accent ?? DEFAULT_CUSTOM, tabs: initTabs, shortcuts: initShort });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);
  const look = (c: PaletteChoice, a: string) => JSON.stringify(c === 'custom' ? [c, a] : [c]);
  // Compared against what was last saved here (not the page prop, which refreshes a moment later).
  const dirty = JSON.stringify([tabs, shortcuts]) !== JSON.stringify([saved.current.tabs, saved.current.shortcuts]) || look(palette, accent) !== look(saved.current.palette, saved.current.accent);
  const show = (c: PaletteChoice, a: string) => (c === 'custom' ? applyPalette(undefined, false, a) : applyPalette(c, false));
  // Picking a palette previews it live; leaving without saving puts the saved one back.
  useEffect(() => () => show(saved.current.palette, saved.current.accent), []);
  const pick = (id: PaletteChoice, a: string = accent) => {
    setPalette(id);
    setAccent(a);
    show(id, a);
    setMsg((m) => (m && !m.ok ? null : m)); // an old error no longer applies once you change something
  };

  const label = (t: Tab) => (t.type === 'route' ? ROUTE_TABS[t.id].label : boards.find((b) => b.slug === t.slug)?.title ?? t.slug);
  const mover = (set: React.Dispatch<React.SetStateAction<Tab[]>>) => (i: number, d: number) =>
    set((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const moveTab = mover(setTabs);
  const moveShort = mover(setShortcuts);
  const used = new Set([...tabs, ...shortcuts].map(keyOf));

  const save = () =>
    start(async () => {
      setMsg(null);
      const { palette: _p, accent: _a, ...rest } = layout;
      const res = await saveAppLayout({ ...rest, v: 1, tabs, shortcuts, ...(palette === 'custom' ? { accent } : { palette }) });
      if (res.ok) {
        saved.current = { palette, accent, tabs, shortcuts };
        setEditing(false);
        if (palette === 'custom') applyPalette(undefined, true, accent);
        else applyPalette(palette);
      }
      setMsg(res.ok ? { ok: true, text: 'Saved. Your app is updated.' } : { ok: false, text: res.error });
    });

  const picker = (value: string, onChange: (k: string) => void, text: string, isTaken: (k: string) => boolean) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={text} className="field h-11 w-full text-[15px]">
      {value === '' && <option value="">{text}</option>}
      <optgroup label="Places">
        {placesFor(admin).map((id) => (
          <option key={id} value={`r:${id}`} disabled={isTaken(`r:${id}`)}>
            {ROUTE_TABS[id].label}
          </option>
        ))}
      </optgroup>
      {boards.length > 0 && (
        <optgroup label="Your boards">
          {boards.map((b) => (
            <option key={b.slug} value={`b:${b.slug}`} disabled={isTaken(`b:${b.slug}`)}>
              {b.title}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );

  const iconBtn = 'grid size-10 flex-none place-items-center rounded-full bg-muted disabled:opacity-30';

  return (
    <NavBar title="Colour" backHref="/settings" backLabel="Back to settings">
      <header className="mb-5">
                <h1 className="text-[28px] font-medium leading-tight tracking-[-0.04em]">Colour</h1>
        <p className="mt-1.5 text-[15px] text-fg-3">One colour sets the look of the whole app, in light and dark.</p>
      </header>

      <section aria-labelledby="pal-h" className="mb-7 space-y-2">
        <h2 id="pal-h" className="kicker">Your colour</h2>
        <PalettePicker value={palette} accent={accent} onChange={pick} editing={editing} onEditing={setEditing} />
        <p className="text-[13px] text-fg-3">Choose Custom to pick any colour on the wheel, or one of the ready-made looks. It previews as you pick; Save keeps it on all your devices.</p>
      </section>

      {msg && (
        <p role="status" className={`mt-4 flex items-center gap-1.5 text-sm ${msg.ok ? 'text-fg' : 'text-fg-2'}`}>
          {msg.ok && <Check className="size-4" />} {msg.text}
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={() => { setTabs(DEFAULT_TABS); setShortcuts(DEFAULT_SHORTCUTS); pick(DEFAULT_PALETTE); setEditing(false); }} className="btn btn-glass flex-1">Reset</button>
        <button type="button" onClick={save} disabled={pending || !dirty} className="btn btn-primary flex-1 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
        </button>
      </div>
      <p className="pt-3 text-center text-[13px]">
        <Link href="/settings" className="text-fg-3 underline decoration-fg-4 underline-offset-4">Back to settings</Link>
      </p>

      {/* Always in reach: the real Save sits far down the page, so changes up here get a floating one. */}
      {(dirty || msg) && (
        <div className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+24px+var(--safe-bottom))] z-[55] mx-auto max-w-sm" role="status">
          <div className="glass-strong flex items-center gap-3 rounded-full py-2 pl-5 pr-2 shadow-[var(--shadow-float)]">
            <span className="min-w-0 flex-1 truncate text-[14px] text-fg-2">
              {msg && !msg.ok ? (
                <span className="text-fg">{msg.text}</span>
              ) : dirty ? (
                'Unsaved changes'
              ) : (
                <span className="flex items-center gap-1.5 text-fg">
                  <Check className="size-4" /> Saved
                </span>
              )}
            </span>
            {dirty && (
              <button type="button" onClick={save} disabled={pending} className="btn btn-primary h-10 px-6 disabled:opacity-60">
                {pending ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    </NavBar>
  );
}
