import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { StickyHeader } from '@/components/sticky-header';

/** Page title block, pinned to the top while the content below scrolls. */
export function PageHeader({
  kicker,
  title,
  sub,
  actions,
  back,
}: {
  /** Mobile back button, for screens that aren't tabs (e.g. Agents, Activity). */
  back?: { href: string; label: string };
  kicker?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <StickyHeader className="mb-4 md:mb-6">
      <header className="rise">
        {back && (
          <Link
            href={back.href}
            transitionTypes={['nav-back']}
            aria-label={back.label}
            className="-ml-2 mb-1 grid size-11 place-items-center rounded-full text-fg transition-colors active:bg-muted md:hidden"
          >
            <ArrowLeft className="size-[21px]" strokeWidth={1.75} />
          </Link>
        )}
        {kicker && <p className="kicker mb-2.5">{kicker}</p>}
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-[32px] font-medium leading-[1.1] tracking-[-0.045em] md:text-[36px]">{title}</h1>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {sub && <p className="mt-1.5 text-sm text-fg-3">{sub}</p>}
      </header>
    </StickyHeader>
  );
}
