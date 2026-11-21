'use client';

/** An on/off switch with its label beside it, so it's clear what it controls and which way it's set. */
export function Switch({ on, onChange, label, sub, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="flex min-w-0 items-center gap-2.5 text-left disabled:opacity-50">
      <span className={`relative h-[26px] w-[44px] flex-none rounded-full transition-colors duration-200 ${on ? 'bg-btn' : 'bg-muted'}`}>
        <span className={`absolute top-[3px] size-5 rounded-full bg-surface shadow transition-transform duration-200 ease-[var(--ease-out-quint)] ${on ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
      </span>
      <span className="flex-none">
        <span className="block whitespace-nowrap text-[13.5px] text-fg">{label}</span>
        {sub && <span className="block truncate text-[11.5px] text-fg-3">{sub}</span>}
      </span>
    </button>
  );
}
