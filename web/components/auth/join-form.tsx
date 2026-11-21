'use client';
import { useState, useTransition } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { joinWithCode } from '@/app/auth/actions';

export function JoinForm({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  if (done) {
    return (
      <div className="card p-5">
        <p className="text-[17px] font-medium tracking-tight">Check your email.</p>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          We sent an invite to <span className="text-fg">{email.trim()}</span>. Tap <span className="text-fg">Accept invite</span> in it within an hour.
        </p>
      </div>
    );
  }
  return (
    <form
      className="card space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError('');
          const r = await joinWithCode(code, email, hp);
          if (r.ok) setDone(true);
          else setError(r.error);
        });
      }}
    >
      <input
        className="field font-mono uppercase tracking-[0.12em] placeholder:normal-case placeholder:tracking-normal"
        placeholder="Invite code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={40}
        autoCapitalize="characters"
        aria-label="Invite code"
      />
      <input type="email" inputMode="email" autoComplete="email" className="field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Your email" />
      {/* honeypot: hidden from people, filled by bots */}
      <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" aria-hidden name="company" />
      <button className="btn btn-primary w-full" disabled={pending || !code.trim() || !email.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" strokeWidth={1.75} />}
        Get my invite
      </button>
      {error && <p className="text-sm text-fg">{error}</p>}
    </form>
  );
}
