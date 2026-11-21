'use client';
import { useState, useTransition } from 'react';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { decide } from './actions';

type Done = { url: string; allowed: boolean };

/** Allow / Deny, then a clear final state: this tab can stay open after the browser hands off to an app. */
export function ConsentForm({ host, children }: { host: string; children: React.ReactNode }) {
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<'allow' | 'deny' | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="glass-strong rise-2 mt-8 space-y-4 rounded-[28px] p-6 text-center" role="status">
        <span className={`mx-auto grid size-12 place-items-center rounded-full ${done.allowed ? 'bg-accent text-on-accent' : 'bg-muted text-fg-2'}`}>
          {done.allowed ? <Check className="size-6" strokeWidth={2.2} /> : <X className="size-6" />}
        </span>
        <p className="text-[20px] font-medium tracking-[-0.03em]">{done.allowed ? 'Connected' : 'Not connected'}</p>
        <p className="text-sm leading-relaxed text-fg-3">
          {done.allowed ? `Go back to ${host}. You can close this tab.` : `Nothing was shared. You can close this tab.`}
        </p>
        <a href={done.url} className="btn btn-glass w-full">
          Return to {host}
        </a>
      </div>
    );
  }

  return (
    <form
      className="glass-strong rise-2 mt-8 space-y-4 rounded-[28px] p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const decision = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'allow' ? 'allow' : 'deny';
        const fd = new FormData(e.currentTarget);
        fd.set('decision', decision);
        setChoice(decision);
        setError('');
        start(async () => {
          try {
            const r = await decide(fd);
            setDone(r);
            window.location.assign(r.url);
          } catch {
            setError('Something went wrong. Please try again.');
          }
        });
      }}
    >
      {children}
      {error && <p className="text-sm text-fg">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button name="decision" value="deny" disabled={pending} className="btn btn-glass flex-1">
          {pending && choice === 'deny' ? <Loader2 className="size-4 animate-spin" /> : 'Deny'}
        </button>
        <button name="decision" value="allow" disabled={pending} className="btn btn-primary flex-1">
          {pending && choice === 'allow' ? <Loader2 className="size-4 animate-spin" /> : 'Allow'}
        </button>
      </div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-3">
        <ShieldCheck className="mt-0.5 size-3.5 flex-none" strokeWidth={1.75} />
        It appears under Agents, where you can revoke it any time. Access renews every 30 days while you use it.
      </p>
    </form>
  );
}
