'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * iOS-style navigation bar: sticky glass, back on the left, actions on the right.
 * The compact title fades in once the large title (the next sibling) scrolls under it.
 */
export function NavBar({
  title,
  actions,
  children,
  backHref = '/home',
  backLabel = 'Back',
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** null for a tab's root screen: no back button. */
  backHref?: string | null;
  backLabel?: string;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div
        className={`sticky top-0 z-30 -mx-4 -mt-[calc(20px+var(--safe-top))] mb-3 px-4 pb-2 pt-[calc(10px+var(--safe-top))] transition-[background-color,border-color] duration-200 sm:-mx-6 sm:px-6 md:static md:m-0 md:mb-5 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none ${
          compact ? 'border-b border-line bg-page/90 backdrop-blur-xl' : 'border-b border-transparent bg-page'
        }`}
      >
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
          {backHref ? (
            <Link
              href={backHref}
              transitionTypes={['nav-back']}
              className="-ml-2 grid size-11 place-items-center rounded-full text-fg transition-colors active:bg-muted"
              aria-label={backLabel}
            >
              <ArrowLeft className="size-[21px]" strokeWidth={1.75} />
            </Link>
          ) : (
            <span className="size-11" aria-hidden />
          )}
          <p
            className="truncate text-center text-[15px] font-medium tracking-tight md:invisible"
          >
            {title}
          </p>
          <div className="flex min-w-10 items-center justify-end gap-2">{actions}</div>
        </div>
      </div>
      <div ref={sentinel}>{children}</div>
    </>
  );
}
