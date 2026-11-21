'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PALETTES, PALETTE_IDS, type PaletteId } from '@/lib/palettes';
import { makeCustomPalette } from '@/lib/custom-palette';
import { ColorWheel } from '@/components/settings/color-wheel';

export type PaletteChoice = PaletteId | 'custom';

/** Tiny palette preview: light half, dark half, and the accent colour on top. */
function Swatch({ id, accent, className = 'size-9' }: { id: PaletteChoice; accent: string; className?: string }) {
  const p = id === 'custom' ? makeCustomPalette(accent).swatch : PALETTES[id];
  return (
    <span className={`relative flex flex-none overflow-hidden rounded-xl ring-1 ring-line ${className}`} aria-hidden>
      <span className="flex-1" style={{ background: p.light.page }} />
      <span className="flex-1" style={{ background: p.dark.page }} />
      <span className="absolute left-1/2 top-1/2 size-[42%] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2" style={{ background: p.light.accent, ['--tw-ring-color' as string]: p.dark.page }} />
      <span className="absolute inset-x-[18%] bottom-[14%] h-[14%] rounded-full" style={{ background: p.light.ink, opacity: 0.8 }} />
    </span>
  );
}

/** Palette as a compact dropdown. Picking one previews it live on the page; Save keeps it. */
export function PalettePicker({
  value,
  accent,
  onChange,
  editing,
  onEditing,
}: {
  value: PaletteChoice;
  accent: string;
  onChange: (id: PaletteChoice, accent: string) => void;
  /** Whether the colour wheel is open. The parent closes it after Save and Reset. */
  editing: boolean;
  onEditing: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cur = value === 'custom' ? { label: 'Custom', blurb: 'One colour you pick. Light and dark are made for you.' } : PALETTES[value];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Palette: ${cur.label}`}
        onClick={() => setOpen((v) => !v)}
        className="card flex h-16 w-full items-center gap-3 px-3 text-left active:scale-[0.99]"
      >
        <Swatch id={value} accent={accent} className="size-10" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{cur.label}</span>
          <span className="block truncate text-[12px] text-fg-3">{cur.blurb}</span>
        </span>
        <ChevronDown className={`size-5 flex-none text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Palette" className="glass-strong absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-2xl border border-line p-1.5 shadow-[var(--shadow-float)]">
          {PALETTE_IDS.map((id) => {
            const p = PALETTES[id];
            return (
              <li key={id} role="option" aria-selected={id === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(id, accent);
                    onEditing(false);
                    setOpen(false);
                  }}
                  className={`flex h-14 w-full items-center gap-3 rounded-xl px-2.5 text-left active:bg-muted ${id === value ? 'bg-muted' : ''}`}
                >
                  <Swatch id={id} accent={accent} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium">{p.label}</span>
                    <span className="block truncate text-[12px] text-fg-3">{p.blurb}</span>
                  </span>
                  {id === value && <Check className="size-4 flex-none text-fg-3" />}
                </button>
              </li>
            );
          })}
          <li role="option" aria-selected={value === 'custom'}>
            <button
              type="button"
              onClick={() => {
                onChange('custom', accent);
                onEditing(true);
                setOpen(false);
              }}
              className={`flex h-14 w-full items-center gap-3 rounded-xl px-2.5 text-left active:bg-muted ${value === 'custom' ? 'bg-muted' : ''}`}
            >
              <Swatch id="custom" accent={accent} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">Custom</span>
                <span className="block truncate text-[12px] text-fg-3">Pick one colour of your own</span>
              </span>
              {value === 'custom' && <Check className="size-4 flex-none text-fg-3" />}
            </button>
          </li>
        </ul>
      )}
      {value === 'custom' && editing && <ColorWheel value={accent} onChange={(c) => onChange('custom', c)} onDone={() => onEditing(false)} />}
      {value === 'custom' && !editing && (
        <button type="button" onClick={() => onEditing(true)} className="card mt-2 flex h-12 w-full items-center gap-3 px-3 text-left active:scale-[0.99]">
          <span className="size-6 flex-none rounded-full ring-1 ring-line" style={{ background: accent }} aria-hidden />
          <span className="flex-1 text-[14.5px]">Change colour</span>
          <ChevronDown className="size-4 text-fg-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
