'use client';
import { useOptimistic, useTransition } from 'react';
import { Check } from 'lucide-react';
import { toggleItem } from '@/app/(app)/actions';
import { useReadOnly } from '@/components/readonly';


/** One checkbox style everywhere; urgency is shown by the text, never the ring. */
export function ItemCheck({ slug, id, done, label, widgetId }: { slug: string; id: string; done: boolean; label: string; tone?: string; widgetId?: string }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  const ro = useReadOnly();
  if (ro) {
    return (
      <span role="img" aria-label={done ? `Done: ${label}` : label} className="-m-2 grid size-9 flex-none place-items-center">
        <span className={`grid size-[18px] place-items-center rounded-full border-[1.5px] ${done ? 'border-btn bg-btn text-on-btn' : 'border-fg-4 text-transparent'}`}>
          <Check className="size-3" strokeWidth={3} />
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={optimistic}
      aria-label={`${optimistic ? 'Untick' : 'Tick'} ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          setOptimistic(!optimistic);
          await toggleItem(slug, id, !optimistic, widgetId);
        });
      }}
      className={`-m-2 grid size-9 flex-none place-items-center rounded-full transition-transform active:scale-90`}
    >
      <span
        className={`grid size-[18px] place-items-center rounded-full border-[1.5px] transition-all duration-200 ${
          optimistic ? 'border-btn bg-btn text-on-btn' : 'border-fg-4 text-transparent'
        }`}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}
