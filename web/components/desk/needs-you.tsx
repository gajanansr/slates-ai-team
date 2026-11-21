'use client';
import { useState, useTransition } from 'react';
import { ArrowUp, Check, CircleHelp, ShieldQuestion, X } from 'lucide-react';
import { answerQuestion, decideApproval } from '@/app/(app)/desk-actions';

/** A question or approval from an agent that waits for you. */
export type DeskRow = { id: string; type: 'question' | 'approval'; text: string; context?: string; options?: string[]; from: string };

/** Answer agents right where you read: one tap for an option or a decision, or a short reply. */
export function NeedsYou({ rows }: { rows: DeskRow[] }) {
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const list = rows.filter((r) => !gone.includes(r.id));
  if (list.length === 0) return null;

  const send = (id: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError('');
    setGone((g) => [...g, id]);
    navigator.vibrate?.(8);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setGone((g) => g.filter((x) => x !== id));
        setError(r.error);
      }
    });
  };

  return (
    <ul className="space-y-2">
      {list.map((r) => (
        <li key={r.id} className="card p-3.5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2">
              {r.type === 'approval' ? <ShieldQuestion className="size-4" strokeWidth={1.8} /> : <CircleHelp className="size-4" strokeWidth={1.8} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-fg-3">{r.type === 'approval' ? `${r.from} wants to` : `${r.from} asks`}</p>
              <p className="text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{r.text}</p>
              {r.context && <p className="mt-0.5 text-[13px] leading-snug text-fg-3 [overflow-wrap:anywhere]">{r.context}</p>}
            </div>
          </div>
          {r.type === 'approval' ? (
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={pending} onClick={() => send(r.id, () => decideApproval(r.id, true))} className="btn btn-accent h-10 flex-1 text-[14px]">
                <Check className="size-4" strokeWidth={2} /> Approve
              </button>
              <button type="button" disabled={pending} onClick={() => send(r.id, () => decideApproval(r.id, false))} className="btn btn-glass h-10 flex-1 text-[14px]">
                <X className="size-4" strokeWidth={2} /> Decline
              </button>
            </div>
          ) : (
            <Reply options={r.options} disabled={pending} onSend={(a) => send(r.id, () => answerQuestion(r.id, a))} />
          )}
        </li>
      ))}
      {error && <li className="px-1 text-sm text-fg">{error}</li>}
    </ul>
  );
}

function Reply({ options, disabled, onSend }: { options?: string[]; disabled: boolean; onSend: (answer: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-3">
      {options && options.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {options.map((o) => (
            <button key={o} type="button" disabled={disabled} onClick={() => onSend(o)} className="h-9 rounded-full bg-muted px-3.5 text-[14px] font-medium active:scale-95">
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSend(text.trim());
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Your answer" placeholder={options?.length ? 'Or write your own answer' : 'Your answer'} className="field h-10 min-w-0 flex-1 text-[15px]" />
        <button type="submit" disabled={disabled || !text.trim()} aria-label="Send answer" className="grid size-10 flex-none place-items-center rounded-full bg-accent text-on-accent disabled:opacity-40">
          <ArrowUp className="size-4" strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
