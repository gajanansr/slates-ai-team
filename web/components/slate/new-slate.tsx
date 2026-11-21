'use client';
import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { createNote } from '@/app/(app)/actions';
import { createFromTemplate } from '@/app/(app)/feature-actions';
import { TEMPLATES } from '@/lib/templates';
import { ICONS } from '@/components/board-icon';

export function NewSlateButton({ label, icon, defaultOpen = false }: { label?: string; icon?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={label ? 'btn btn-glass h-11 px-3 text-[14px]' : 'btn btn-glass btn-icon'}
        aria-label={label ? undefined : 'New slate'}
      >
        {icon ?? <Plus className={label ? 'size-4' : 'size-[18px]'} strokeWidth={1.75} />}
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New board">
        <p className="kicker mb-2">Start from a template</p>
        <ul className="mb-5 grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => {
            const I = ICONS[t.icon];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setPicked(t.id);
                    start(async () => {
                      const r = await createFromTemplate(t.id);
                      if (r && !r.ok) setError(r.error);
                    });
                  }}
                  className="flex h-full w-full flex-col items-start gap-1 rounded-2xl bg-muted p-3 text-left active:scale-[0.98]"
                >
                  {pending && picked === t.id ? <Loader2 className="size-[18px] animate-spin" /> : <I className="size-[18px]" strokeWidth={1.7} />}
                  <span className="text-[14px] font-medium">{t.title}</span>
                  <span className="text-[12px] leading-snug text-fg-3">{t.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="kicker mb-2">Or a blank list</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createNote(title);
              if (r && !r.ok) setError(r.error);
            });
          }}
          className="space-y-3"
        >
          <input
            className="field"
            placeholder="Name, e.g. Groceries"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <p className="text-xs leading-relaxed text-fg-3">
            Tip: agents can create richer slates (tables, metrics, timelines). Ask yours: &ldquo;Create a Slates table of my
            subscriptions.&rdquo;
          </p>
          {error && <p className="text-sm text-fg">{error}</p>}
          <button className="btn btn-primary w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Create
          </button>
        </form>
      </Sheet>
    </>
  );
}
