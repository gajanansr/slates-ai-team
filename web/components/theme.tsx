'use client';
import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyPalette, applyTheme, readPref, savePref, type ThemePref } from '@/lib/theme';

/** Keeps the theme in step with the OS when the preference is "system". */
export function ThemeSync() {
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme(readPref());
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return null;
}

/** Applies the palette saved in your layout (the server is the source of truth; localStorage only avoids a flash). */
export function PaletteSync({ palette, accent }: { palette?: string; accent?: string }) {
  useEffect(() => {
    applyPalette(palette, true, accent);
  }, [palette, accent]);
  return null;
}

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/** Segmented control: System / Light / Dark. */
export function AppearanceControl() {
  const [pref, setPref] = useState<ThemePref>('system');
  useEffect(() => {
    setPref(readPref());
  }, []);
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-[18px] bg-muted p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setPref(value);
              savePref(value);
            }}
            className={`flex h-11 items-center justify-center gap-2 rounded-[14px] text-[14px] font-medium transition-all duration-200 active:scale-[0.97] ${
              active ? 'bg-surface text-fg shadow-[var(--shadow-card)]' : 'text-fg-3'
            }`}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
