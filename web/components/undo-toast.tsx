'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { UNDO_EVENT, type UndoRequest } from '@/lib/undo';
import { undoChange } from '@/app/(app)/feature-actions';

const SHOW_MS = 7000;
/** The change itself is still being saved for a moment; Undo waits for it. */
const ARM_MS = 1200;

/** "Note deleted · Undo": a few seconds to take back a delete or an archive, from anywhere in the app. */
export function UndoToast() {
  const router = useRouter();
  const [req, setReq] = useState<UndoRequest | null>(null);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const clear = () => timers.current.splice(0).forEach(clearTimeout);
    const on = (e: Event) => {
      clear();
      setMsg('');
      setArmed(false);
      setReq((e as CustomEvent<UndoRequest>).detail);
      timers.current.push(setTimeout(() => setArmed(true), ARM_MS), setTimeout(() => setReq(null), SHOW_MS));
    };
    window.addEventListener(UNDO_EVENT, on);
    return () => {
      window.removeEventListener(UNDO_EVENT, on);
      clear();
    };
  }, []);

  if (!req && !msg) return null;
  const undo = () =>
    req &&
    start(async () => {
      const r = await undoChange(req.undo);
      timers.current.splice(0).forEach(clearTimeout);
      setReq(null);
      setMsg(r.ok ? 'Put back' : r.error);
      timers.current.push(setTimeout(() => setMsg(''), 2500));
      if (r.ok) router.refresh();
    });

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+22px+var(--safe-bottom))] z-[70] flex justify-center px-4 md:bottom-6">
      <div className="glass-strong pointer-events-auto flex max-w-sm items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[14px] shadow-[var(--shadow-float)]">
        <span className="min-w-0 truncate">{req ? req.label : msg}</span>
        {req && (
          <button type="button" onClick={undo} disabled={!armed || pending} className={`btn btn-primary h-9 flex-none px-3.5 text-[13.5px] disabled:opacity-50 ${pending ? 'animate-pulse' : ''}`}>
            <Undo2 className="size-4" strokeWidth={2} /> Undo
          </button>
        )}
      </div>
    </div>
  );
}
