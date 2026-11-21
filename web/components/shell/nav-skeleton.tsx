'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { PageLoader } from '@/components/page-loader';

/** Long enough that a page which is already loaded never flashes a skeleton. */
const SHOW_AFTER_MS = 90;
const GIVE_UP_MS = 10_000;

/**
 * Every tap answers at once. The moment you tap a link to another page, a skeleton takes the
 * screen until that page arrives, however slow the network is. Without it a tap can sit for a
 * beat with nothing happening, which reads as the app ignoring you.
 */
export function NavSkeleton() {
  const path = usePathname();
  const [show, setShow] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => {
    timers.current.splice(0).forEach(clearTimeout);
    setShow(false);
  };

  // The page arrived (or we went somewhere else): drop the skeleton.
  useEffect(clear, [path]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(a.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      // Only pages inside the app shell; sign-out, exports and public pages load on their own.
      if (/^\/(api|auth|p|share|guide|llms\.txt)(\/|$)/.test(url.pathname)) return;
      timers.current.splice(0).forEach(clearTimeout);
      timers.current.push(setTimeout(() => setShow(true), SHOW_AFTER_MS), setTimeout(clear, GIVE_UP_MS));
    };
    // Capture phase, so it runs even when the link's own handler closes a sheet first.
    document.addEventListener('click', onClick, true);
    window.addEventListener('pageshow', clear);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pageshow', clear);
      timers.current.splice(0).forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) return null;
  return (
    <div aria-hidden className="fixed inset-0 z-40 overflow-hidden bg-page md:left-60">
      <div className="mx-auto w-full max-w-3xl px-4 pt-[calc(20px+var(--safe-top))] sm:px-6 md:pt-10 lg:max-w-5xl">
        <PageLoader />
      </div>
    </div>
  );
}
