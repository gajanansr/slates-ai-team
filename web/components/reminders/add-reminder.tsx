'use client';
import { useRef, useState, useTransition } from 'react';
import { Loader2, Plus, Repeat as RepeatIcon } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Select } from '@/components/ui/select';
import { addReminder } from '@/app/(app)/reminder-actions';
import type { Repeat } from '@/lib/reminders';

const REPEATS: { value: Repeat | 'once'; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

/** The next whole hour on this device. */
function nextHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return d;
}

export function AddReminder() {
  const [text, setText] = useState('');
  const [when, setWhen] = useState(nextHour);
  const [repeat, setRepeat] = useState<Repeat | 'once'>('once');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError('');
          const r = await addReminder(text, when.toISOString(), repeat === 'once' ? '' : repeat);
          if (!r.ok) return setError(r.error);
          setText('');
          setWhen(nextHour());
          setRepeat('once');
          input.current?.focus();
        });
      }}
    >
      <input
        ref={input}
        className="field"
        placeholder="Remind me to…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={200}
        enterKeyHint="done"
        aria-label="Reminder"
      />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)] gap-2">
        <DateTimePicker value={when} onChange={setWhen} />
        <Select
          label="Repeat"
          value={repeat}
          onChange={setRepeat}
          options={REPEATS.map((r) => ({ ...r, icon: r.value === 'once' ? undefined : RepeatIcon }))}
        />
      </div>
      <button className="btn btn-primary w-full" disabled={pending || !text.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        Add reminder
      </button>
      {error && <p className="text-sm text-fg">{error}</p>}
    </form>
  );
}
