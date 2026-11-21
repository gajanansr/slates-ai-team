'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { joinWaitlist } from '@/app/auth/actions';

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [hp, setHp] = useState('');
  const [result, setResult] = useState<{ status: 'added' | 'already' | 'member'; position: number } | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  if (result?.status === 'member')
    return (
      <div className="card p-5">
        <p className="text-[17px] font-medium tracking-tight">You already have Slates.</p>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          <Link href="/" className="text-fg underline decoration-fg-4 underline-offset-4">
            Sign in
          </Link>{' '}
          with {email.trim()}.
        </p>
      </div>
    );
  if (result)
    return (
      <div className="card p-5">
        <span className="mb-4 grid size-11 place-items-center rounded-2xl bg-accent text-on-accent">
          <Check className="size-5" strokeWidth={2.2} />
        </span>
        <p className="text-[17px] font-medium tracking-tight">{result.status === 'already' ? "You're already on the list." : "You're on the list."}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
          {result.position > 0 && (
            <>
              You&apos;re <span className="text-fg">#{result.position}</span> in line.{' '}
            </>
          )}
          We&apos;ll email <span className="text-fg">{email.trim()}</span> when your spot opens.
        </p>
      </div>
    );

  return (
    <form
      className="card space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError('');
          const r = await joinWaitlist(email, '', note, hp);
          if (r.ok) setResult({ status: r.status, position: r.position });
          else setError(r.error);
        });
      }}
    >
      <input type="email" inputMode="email" autoComplete="email" className="field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Your email" required />
      <input className="field" placeholder="What would you use it for? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} aria-label="What would you use it for" />
      {/* honeypot: hidden from people, filled by bots */}
      <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" aria-hidden name="company" />
      <button className="btn btn-primary w-full" disabled={pending || !email.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" strokeWidth={1.75} />}
        Join the waitlist
      </button>
      {error && <p className="text-sm text-fg">{error}</p>}
    </form>
  );
}
