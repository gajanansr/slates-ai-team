'use client';
import { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'cards' | 'list';

export const viewCookie = (key: string) => `slates-view-${key}`;

/**
 * Cards or list, remembered per screen in a cookie. The server reads the cookie and passes
 * `initial`, so the page renders in the chosen view from the first frame (no cards-then-list flash).
 */
export function useViewMode(key: string, initial: ViewMode = 'cards') {
  const [mode, setMode] = useState<ViewMode>(initial);
  const set = (m: ViewMode) => {
    setMode(m);
    document.cookie = `${viewCookie(key)}=${m}; path=/; max-age=31536000; samesite=lax`;
  };
  return [mode, set] as const;
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="View" className="relative flex h-10 flex-none gap-0.5 rounded-full bg-muted p-1">
      <span
        aria-hidden
        className="absolute top-1 h-8 w-9 rounded-full bg-surface shadow-[var(--shadow-card)] transition-transform duration-300 ease-[var(--ease-out-quint)]"
        style={{ transform: `translateX(${mode === 'list' ? 38 : 0}px)` }}
      />
      {(
        [
          ['cards', LayoutGrid, 'Cards'],
          ['list', List, 'List'],
        ] as const
      ).map(([m, I, label]) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={label}
          onClick={() => onChange(m)}
          className={`relative grid h-8 w-9 place-items-center rounded-full transition-colors ${mode === m ? 'text-fg' : 'text-fg-3'}`}
        >
          <I className="size-4" strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}
