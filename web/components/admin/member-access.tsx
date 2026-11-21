'use client';
import { useState, useTransition } from 'react';
import { Minus, Plus } from 'lucide-react';
import { setMemberAccess } from '@/app/(app)/invite-actions';

/** Admin control: invite access switch + allowance stepper for one member. */
export function MemberAccess({ userId, canInvite, quota, used }: { userId: string; canInvite: boolean; quota: number; used: number }) {
  const [on, setOn] = useState(canInvite);
  const [q, setQ] = useState(quota);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const save = (nextOn: boolean, nextQ: number) =>
    start(async () => {
      const prev = { on, q };
      setOn(nextOn);
      setQ(nextQ);
      setErr('');
      setNote('');
      const r = await setMemberAccess(userId, nextOn, nextQ, nextOn && !prev.on);
      if (r.ok && 'mail' in r && r.mail) setNote(r.mail);
      if (!r.ok) {
        setOn(prev.on);
        setQ(prev.q);
        setErr(r.error);
      }
    });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <label className="flex cursor-pointer items-center gap-2.5">
        <input type="checkbox" role="switch" checked={on} disabled={pending} onChange={() => save(!on, q)} className="peer sr-only" />
        <span
          aria-hidden
          className="relative h-[26px] w-[44px] flex-none rounded-full bg-muted transition-colors peer-checked:bg-btn after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-[18px] peer-checked:after:bg-on-btn"
        />
        <span className="text-[13.5px] text-fg-2">Can invite</span>
      </label>
      <span className="flex items-center gap-1 rounded-full bg-muted p-1" aria-label="Invite allowance">
        <button type="button" className="grid size-7 place-items-center rounded-full active:bg-surface" onClick={() => save(on, Math.max(0, q - 1))} disabled={pending || q <= 0} aria-label="Fewer invites">
          <Minus className="size-3.5" />
        </button>
        <span className="min-w-[56px] text-center text-[12.5px] tabular-nums text-fg-2">
          {used}/{q} used
        </span>
        <button type="button" className="grid size-7 place-items-center rounded-full active:bg-surface" onClick={() => save(on, Math.min(100, q + 1))} disabled={pending || q >= 100} aria-label="More invites">
          <Plus className="size-3.5" />
        </button>
      </span>
      {err && <span className="text-xs text-fg">{err}</span>}
      {note && <span className="w-full text-xs text-fg-3">{note}</span>}
    </div>
  );
}
