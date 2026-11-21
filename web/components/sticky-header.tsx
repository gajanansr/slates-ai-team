'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Pins a page's title area to the top (under the status bar) while content scrolls
 * beneath it. Cancels <main>'s top padding so it sits flush, and shows a hairline
 * once the page has scrolled.
 */
export function StickyHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden className="h-0" />
      <div
        className={`sticky top-0 z-30 -mx-4 -mt-[calc(20px+var(--safe-top))] bg-page px-4 pb-3 pt-[calc(20px+var(--safe-top))] transition-[border-color,box-shadow] duration-200 sm:-mx-6 sm:px-6 md:-mt-10 md:pt-10 ${
          scrolled ? 'border-b border-line shadow-[0_8px_16px_-14px_rgb(0_0_0/0.25)]' : 'border-b border-transparent'
        } ${className}`}
      >
        {children}
      </div>
    </>
  );
}
