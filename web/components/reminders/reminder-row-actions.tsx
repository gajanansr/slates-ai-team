'use client';
import { useTransition } from 'react';
import { Loader2, X } from 'lucide-react';
import { cancelReminder, snoozeReminder } from '@/app/(app)/reminder-actions';

export function ReminderRowActions({ id, text }: { id: string; text: string }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-none items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => void snoozeReminder(id, 60))}
        className="h-8 rounded-full bg-muted px-2.5 text-[12px] font-medium text-fg-2 active:scale-95"
        aria-label={`Snooze ${text} for an hour`}
      >
        +1h
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => void cancelReminder(id))}
        className="grid size-8 place-items-center rounded-full text-fg-3 active:bg-muted"
        aria-label={`Cancel ${text}`}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-4" />}
      </button>
    </span>
  );
}
