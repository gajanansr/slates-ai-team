'use client';
import { useEffect, useState, useTransition } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { VAPID_PUBLIC_KEY } from '@/lib/env';
import { IllustrationPanel } from '@/components/illustrations';
import { removePushSubscription, saveNotificationPrefs, savePushSubscription, sendTestPush } from '@/app/(app)/push-actions';

type State = 'loading' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';
export type Prefs = { on_agent: boolean; on_brief: boolean; on_digest: boolean };

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationsSection({ prefs: initial }: { prefs: Prefs }) {
  const [state, setState] = useState<State>('loading');
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return setState(ios && !standalone ? 'install' : 'unsupported');
      }
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  const enable = () =>
    start(async () => {
      setMsg('');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState(perm === 'denied' ? 'denied' : 'off');
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
      const r = await savePushSubscription(sub.toJSON(), navigator.userAgent);
      if (!r.ok) return setMsg(r.error);
      setState('on');
      const t = await sendTestPush();
      setMsg(t.ok ? 'Test notification sent.' : t.error);
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState('off');
      setMsg('');
    });

  const toggle = (k: keyof Prefs) =>
    start(async () => {
      const next = { ...prefs, [k]: !prefs[k] };
      setPrefs(next);
      const r = await saveNotificationPrefs(next.on_agent, next.on_brief, next.on_digest);
      if (!r.ok) {
        setPrefs(prefs);
        setMsg(r.error);
      }
    });

  const hint: Record<State, string> = {
    loading: '',
    unsupported: "This browser can't receive notifications.",
    install: 'On iPhone, add Slates to your Home Screen first (Share → Add to Home Screen), then open it from there.',
    denied: 'Notifications are blocked. Allow them for Slates in your system settings.',
    off: 'Get a ping when an agent needs you, your brief is ready, and an evening digest.',
    on: 'On for this device.',
  };

  return (
    <section>
      <h2 className="kicker mb-2 px-1">Notifications</h2>
      <div className="card divide-y divide-line">
        {(state === 'off' || state === 'install' || state === 'denied') && (
          <div className="p-3 pb-0">
            <IllustrationPanel name="bell" className="h-[120px]" />
          </div>
        )}
        <div className="flex items-center gap-3 px-4 py-3.5">
          {state === 'on' ? <Bell className="size-[18px] flex-none text-fg-2" strokeWidth={1.6} /> : <BellOff className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />}
          <div className="min-w-0 flex-1">
            <p className="text-[15px]">Push notifications</p>
            <p className="text-xs leading-relaxed text-fg-3">{hint[state]}</p>
          </div>
          {state === 'off' && (
            <button type="button" className="btn btn-primary h-9 px-4 text-sm" onClick={enable} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : 'Turn on'}
            </button>
          )}
          {state === 'on' && (
            <button type="button" className="btn btn-glass h-9 px-4 text-sm" onClick={disable} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : 'Turn off'}
            </button>
          )}
        </div>
        {state === 'on' &&
          (
            [
              ['on_agent', 'When an agent asks', 'Agents decide something needs you now'],
              ['on_brief', 'Brief updated', 'Your Today brief was rewritten'],
              ['on_digest', 'Evening digest', 'One summary at 8pm of what agents changed'],
            ] as const
          ).map(([k, label, desc]) => (
            <label key={k} className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px]">{label}</span>
                <span className="block text-xs text-fg-3">{desc}</span>
              </span>
              <input type="checkbox" role="switch" checked={prefs[k]} onChange={() => toggle(k)} className="peer sr-only" />
              <span
                aria-hidden
                className="relative h-[26px] w-[44px] flex-none rounded-full bg-muted transition-colors peer-checked:bg-btn peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-fg-3 after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-[18px] peer-checked:after:bg-on-btn"
              />
            </label>
          ))}
      </div>
      {msg && <p className="mt-2 px-1 text-xs text-fg-2">{msg}</p>}
    </section>
  );
}
