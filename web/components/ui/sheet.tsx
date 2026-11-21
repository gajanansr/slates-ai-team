'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Native <dialog>: focus trap, Esc and inert background for free.
 * Bottom sheet on phones, centred panel from sm up.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-0 mt-auto w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-page/40 backdrop:backdrop-blur-sm open:animate-[rise_380ms_var(--ease-out-quint)] sm:m-auto sm:max-w-lg"
    >
      <div className="glass-strong max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[28px] p-5 pb-[calc(20px+var(--safe-bottom))] sm:rounded-[28px] sm:p-6">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-fg-4 sm:hidden" />
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-glass btn-icon" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
