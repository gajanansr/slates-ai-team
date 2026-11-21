'use client';
import { useState, useTransition } from 'react';
import { Check, Loader2, Send } from 'lucide-react';
import { letInFromWaitlist } from '@/app/(app)/invite-actions';
import { Ago } from '@/components/time';

export type WaitlistEntry = { email: string; name: string | null; note: string | null; status: 'waiting' | 'invited'; created_at: string; invited_at: string | null };

function Row({ w }: { w: WaitlistEntry }) {
  const [state, setState] = useState<'idle' | 'done'>(w.status === 'invited' ? 'done' : 'idle');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px]">{w.email}</span>
          <span className="block truncate text-[12px] text-fg-3">
            {state === 'done' ? (
              <>
                Let in <Ago iso={w.invited_at ?? new Date().toISOString()} />
              </>
            ) : (
              <>
                Joined <Ago iso={w.created_at} />
              </>
            )}
          </span>
        </span>
        {state === 'done' ? (
          <span className="flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[12.5px] text-fg-3">
            <Check className="size-3.5" /> Invited
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError('');
                const r = await letInFromWaitlist(w.email);
                if (r.ok) setState('done');
                else setError(r.error);
              })
            }
            className="btn btn-primary h-9 px-3.5 text-[13px]"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" strokeWidth={1.8} />} Let in
          </button>
        )}
      </div>
      {w.note && <p className="mt-1.5 line-clamp-2 text-[12.5px] text-fg-2">“{w.note}”</p>}
      {error && <p className="mt-1.5 text-[12.5px]">{error}</p>}
    </li>
  );
}

/** Admin: people waiting to get in. "Let in" sends them the invite email. */
export function WaitlistAdmin({ list }: { list: WaitlistEntry[] }) {
  const [shown, setShown] = useState(20);
  const waiting = list.filter((w) => w.status === 'waiting').length;
  return (
    <section className="card p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-medium tracking-tight">Waitlist</h3>
        <span className="pill">{waiting} waiting</span>
      </div>
      <p className="mb-2 text-[12.5px] text-fg-3">People who asked to join at /waitlist. Let in sends them an invite email.</p>
      {list.length === 0 ? (
        <p className="py-3 text-sm text-fg-3">Nobody yet. Share slates.space/waitlist.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {list.slice(0, shown).map((w) => (
              <Row key={w.email} w={w} />
            ))}
          </ul>
          {list.length > shown && (
            <button type="button" onClick={() => setShown(shown + 20)} className="btn btn-glass mt-2 w-full">
              Show more · {list.length - shown} left
            </button>
          )}
        </>
      )}
    </section>
  );
}
