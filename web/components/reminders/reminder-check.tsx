'use client';
import { useOptimistic, useTransition } from 'react';
import { Check } from 'lucide-react';
import { completeReminder } from '@/app/(app)/reminder-actions';

/** Tick a reminder. Repeating ones roll forward on the server. */
export function ReminderCheck({ id, label }: { id: string; label: string; urgent?: boolean }) {
  const [done, setDone] = useOptimistic(false);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`Complete ${label}`}
      onClick={() =>
        start(async () => {
          setDone(true);
          await completeReminder(id);
        })
      }
      className="-m-2 grid size-9 flex-none place-items-center rounded-full transition-transform active:scale-90"
    >
      <span
        className={`grid size-[18px] place-items-center rounded-full border-[1.5px] transition-all duration-200 ${
          done ? 'border-btn bg-btn text-on-btn' : 'border-fg-4 text-transparent'
        }`}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}
