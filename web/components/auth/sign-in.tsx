'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Mail } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { safeNext } from '@/lib/redirect';
import { requestFreshInvite } from '@/app/auth/actions';

function friendly(message: string) {
  if (/signups? not allowed|user not found|not allowed for otp/i.test(message)) return "This email isn't on the member list.";
  if (/rate limit/i.test(message)) return 'Too many emails sent. Try again in a little while, or use Google.';
  if (/expired|invalid/i.test(message)) return 'That code is invalid or has expired. Request a new one.';
  return message;
}

export function SignIn({ next, initialError }: { next?: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState(initialError ?? '');
  const [pending, start] = useTransition();
  const [googlePending, setGooglePending] = useState(false);

  const callback = () => {
    const u = new URL('/auth/callback', window.location.origin);
    const n = safeNext(next, window.location.origin);
    if (n !== '/home') u.searchParams.set('next', n);
    return u.toString();
  };

  const google = async () => {
    setError('');
    setGooglePending(true);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback() },
    });
    if (error) {
      setGooglePending(false);
      setError(friendly(error.message));
    }
  };

  const sendLink = () =>
    start(async () => {
      setError('');
      const value = email.trim();
      if (!/^\S+@\S+\.\S+$/.test(value)) return setError('Enter a valid email.');
      const { error } = await supabaseBrowser().auth.signInWithOtp({
        email: value,
        options: { shouldCreateUser: false, emailRedirectTo: callback() },
      });
      if (error) {
        if (/signups? not allowed|signup_disabled/i.test(error.message)) {
          // Could be an invited account that never accepted: re-send the invite instead.
          const r = await requestFreshInvite(value);
          if (r.status === 'sent') return setError('You have a pending invite. We just emailed you a fresh link: tap Accept invite in it.');
          return setError("This email doesn't have Slates yet. Have an invite code? Use “Join with a code” below, or join the waitlist.");
        }
        return setError(friendly(error.message));
      }
      setStep('code');
    });

  const verify = () =>
    start(async () => {
      setError('');
      const token = code.replace(/\D/g, '');
      if (token.length < 6 || token.length > 10) return setError('Enter the code from the email.');
      const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (error) return setError(friendly(error.message));
      router.replace(safeNext(next, window.location.origin));
      router.refresh();
    });

  return (
    <div className="glass-strong w-full rounded-[28px] p-5 sm:p-6">
      {step === 'email' ? (
        <div className="space-y-3">
          <button type="button" onClick={google} disabled={googlePending} className="btn btn-glass w-full">
            {googlePending ? <Loader2 className="size-4 animate-spin" /> : <GoogleMark />}
            Continue with Google
          </button>
          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-line" />
            <span className="kicker">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendLink();
            }}
            className="space-y-3"
          >
            <label className="sr-only" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
            />
            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" strokeWidth={1.75} />}
              Email me a sign-in link
            </button>
          </form>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          className="space-y-3"
        >
          <p className="text-sm leading-relaxed text-fg-2">
            Check <span className="text-fg">{email}</span>. Tap the link in the email, or enter the code here. Use the code
            if the link opens in a different browser.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Code from the email"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="field text-center font-mono tracking-[0.3em] placeholder:tracking-normal"
            autoFocus
          />
          <button type="submit" disabled={pending} className="btn btn-primary w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" strokeWidth={1.75} />}
            Sign in
          </button>
          <div className="flex justify-between pt-1 text-xs text-fg-3">
            <button type="button" className="py-2 hover:text-fg-2" onClick={() => setStep('email')}>
              Use a different email
            </button>
            <button type="button" className="py-2 hover:text-fg-2" onClick={sendLink} disabled={pending}>
              Resend
            </button>
          </div>
        </form>
      )}
      <p role="alert" aria-live="polite" className={`text-sm text-fg ${error ? 'mt-3' : 'sr-only'}`}>
        {error}
      </p>
    </div>
  );
}

function GoogleMark() {
  // Monochrome "G" so the page stays colour-free.
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.78 3.79 14.6 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51z"
      />
    </svg>
  );
}
