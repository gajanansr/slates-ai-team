'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type Option<T extends string | number> = { value: T; label: string; hint?: string; icon?: React.ComponentType<{ className?: string; strokeWidth?: number }> };

/**
 * The app's dropdown. Replaces <select>: same look in every browser, the chevron sits inside
 * the box, and the list opens in the top layer (popover) so sheets and cards never clip it.
 */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  label,
  className = '',
  size = 'md',
  disabled,
}: {
  value: T | null | '';
  onChange: (v: T) => void;
  options: Option<T>[];
  placeholder?: string;
  /** Accessible name. */
  label: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.value === value);

  // Place the list under (or above) the button, in viewport coordinates.
  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    const p = pop.current;
    if (!b || !p) return;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const want = Math.min(p.scrollHeight, 320);
    const below = vh - b.bottom - 12;
    const up = below < want && b.top > below;
    p.style.left = `${Math.max(8, Math.min(b.left, window.innerWidth - Math.max(b.width, 200) - 8))}px`;
    p.style.minWidth = `${Math.max(b.width, 200)}px`;
    p.style.maxHeight = `${Math.max(160, Math.min(320, up ? b.top - 12 : below))}px`;
    p.style.top = up ? `${Math.max(8, b.top - Math.min(want, b.top - 12) - 6)}px` : `${b.bottom + 6}px`;
  };

  useLayoutEffect(() => {
    if (open) place();
  });
  useEffect(() => {
    const p = pop.current;
    if (!p) return;
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === 'open');
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(i);
    requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
    return () => {
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (o: Option<T>) => {
    onChange(o.value);
    pop.current?.hidePopover();
    btn.current?.focus();
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        popoverTarget={`sel-${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            pop.current?.showPopover();
          }
        }}
        className={`flex w-full min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface text-left transition-colors disabled:opacity-50 ${
          size === 'sm' ? 'h-10 px-3 text-[14px]' : 'h-[50px] px-4 text-[16px]'
        } ${open ? 'border-fg-3' : ''}`}
      >
        {current?.icon && <current.icon className="size-4 flex-none text-fg-3" strokeWidth={1.7} />}
        <span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-fg-4'}`}>{current?.label ?? placeholder}</span>
        <ChevronDown className={`size-4 flex-none text-fg-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} strokeWidth={1.8} />
      </button>
      <div
        ref={pop}
        id={`sel-${id}`}
        popover="auto"
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.max(0, Math.min(options.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
            setActive(n);
            pop.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.focus();
          }
        }}
        className="glass-strong fixed m-0 [inset:auto] overflow-y-auto overscroll-contain rounded-[18px] p-1.5 text-fg shadow-[var(--shadow-float)]"
      >
        {options.map((o, i) => {
          const sel = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={sel}
              data-i={i}
              onClick={() => choose(o)}
              onPointerEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14.5px] outline-none ${i === active ? 'bg-muted' : ''}`}
            >
              {o.icon && <o.icon className="size-4 flex-none text-fg-3" strokeWidth={1.7} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="block truncate text-[12px] text-fg-3">{o.hint}</span>}
              </span>
              {sel && <Check className="size-4 flex-none" strokeWidth={2} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
