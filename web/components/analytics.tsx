'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** Sends one beacon per page view. Respects Do Not Track / Global Privacy Control. */
export function Analytics() {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (!path || path.startsWith('/dev')) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return;
    const body = JSON.stringify({
      path,
      ref: first.current ? document.referrer : '',
      standalone: matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true,
    });
    first.current = false;
    if (!navigator.sendBeacon?.('/api/t', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/t', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
    }
  }, [path]);
  return null;
}
