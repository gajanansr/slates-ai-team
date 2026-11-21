'use client';
import { useState, useTransition } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { requestFreshInvite } from '@/app/auth/actions';

export function FreshLink() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestFreshInvite(email);
          setMsg(
            r.status === 'sent'
              ? 'Done. Check your inbox for a fresh invite (it works for an hour).'
              : r.status === 'member'
                ? 'You already have Slates. Sign in with your email on the home page.'
                : "If that email has a pending invite, a fresh link is on its way. Otherwise, you'll need an invite or code.",
          );
        });
      }}
    >
      <input type="email" inputMode="email" autoComplete="email" className="field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Your email" />
      <button className="btn btn-primary w-full" disabled={pending || !email.trim()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" strokeWidth={1.75} />}
        Email me a fresh link
      </button>
      {msg && <p className="text-sm text-fg-2">{msg}</p>}
    </form>
  );
}
