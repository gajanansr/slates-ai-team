'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanFace } from 'lucide-react';
import { Logo } from '@/components/logo';

/**
 * App lock: a privacy screen unlocked with Face ID / Touch ID / the device passcode via a
 * passkey (WebAuthn, platform authenticator, user verification required). It guards this
 * device's screen only; the account itself is still protected by sign-in.
 */
const KEY = 'slates.lock';
const AWAY_MS = 5 * 60 * 1000;
type Cfg = { id: string };

const read = (): Cfg | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function lockSupported() {
  return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()));
}

export async function enableLock(email: string) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Slates', id: location.hostname },
      user: { id: rand(16), name: email || 'slates', displayName: 'Slates app lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      // Keep it on this device: the browser skips "use another device / security key" options.
      hints: ['client-device'],
      timeout: 60_000,
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Cancelled');
  localStorage.setItem(KEY, JSON.stringify({ id: b64(cred.rawId) }));
}
export const disableLock = () => localStorage.removeItem(KEY);
export const lockEnabled = () => Boolean(read());

/**
 * Ask for Face ID / fingerprint. The prompt itself is drawn by the phone (it shows the site name
 * on purpose, so it can't be restyled); naming this device's key with `internal` transport and the
 * client-device hint makes it the small biometric prompt instead of the full passkey picker.
 */
async function verify(cfg: Cfg) {
  const ok = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: unb64(cfg.id), transports: ['internal'] }],
      userVerification: 'required',
      hints: ['client-device'],
      timeout: 60_000,
    } as PublicKeyCredentialRequestOptions,
  });
  return Boolean(ok);
}

export function AppLock() {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tried = useRef(false);

  useEffect(() => {
    if (read() && !sessionStorage.getItem('slates.unlocked')) setLocked(true);
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (read() && hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
        tried.current = false;
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-locked', locked);
  }, [locked]);

  const unlock = async (auto = false) => {
    const cfg = read();
    if (!cfg) return setLocked(false);
    setBusy(true);
    setError('');
    try {
      if (await verify(cfg)) {
        sessionStorage.setItem('slates.unlocked', '1');
        setLocked(false);
      }
    } catch (e) {
      // Cancelling, or a phone that only allows the prompt after a tap: just wait for a tap.
      const name = (e as DOMException)?.name;
      if (!auto && name !== 'NotAllowedError' && name !== 'AbortError') setError("Couldn't verify. Tap to try again.");
    } finally {
      setBusy(false);
    }
  };

  // Show the Face ID / fingerprint prompt straight away where the phone allows it.
  useEffect(() => {
    if (!locked || tried.current) return;
    tried.current = true;
    const t = setTimeout(() => void unlock(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (!locked) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-page/80 px-6 pb-[calc(32px+var(--safe-bottom))] pt-[calc(18vh+var(--safe-top))] backdrop-blur-2xl"
      role="dialog"
      aria-modal
      aria-label="Slates is locked"
      onClick={() => !busy && void unlock()}
    >
      <div className="text-center">
        <Logo className="mx-auto mb-5 size-16" />
        <p className="text-[22px] font-medium tracking-[-0.03em]">Slates is locked</p>
        <p className="mt-1 text-sm text-fg-3">Tap anywhere to unlock</p>
      </div>
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!busy) void unlock();
          }}
          disabled={busy}
          autoFocus
          aria-label="Unlock with Face ID, fingerprint or passcode"
          className="grid size-20 place-items-center rounded-[28px] bg-accent text-on-accent shadow-[0_12px_32px_-12px_var(--accent)] transition-transform active:scale-95"
        >
          {busy ? <Loader2 className="size-8 animate-spin" /> : <ScanFace className="size-9" strokeWidth={1.5} />}
        </button>
        <p className="mt-3 h-5 text-sm text-fg-2">{error || 'Face ID, fingerprint or passcode'}</p>
        <form action="/auth/signout" method="post" onSubmit={() => localStorage.removeItem(KEY)} onClick={(e) => e.stopPropagation()}>
          <button className="mt-6 text-[13px] text-fg-3 underline underline-offset-4">Sign out instead</button>
        </form>
      </div>
    </div>
  );
}
