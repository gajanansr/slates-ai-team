'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Registers the service worker and keeps instantly-shown pages fresh:
 *  - the worker shows the saved copy of a page at launch, then tells us when a fresh one is in:
 *    we refresh in place (no reload, no spinner);
 *  - coming back to the app after 30s away refreshes the current page in the background.
 */
export function ServiceWorker() {
  const router = useRouter();
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'slates:stale') router.refresh();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.startMessages?.();
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) router.refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [router]);
  return null;
}

/** Drop every cached page (called on sign-out so nothing personal stays offline). */
export async function clearOfflineCache() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage({ type: 'clear' });
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* best effort */
  }
}
