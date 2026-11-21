'use client';
import { useLinkStatus } from 'next/link';
import { ChevronRight } from 'lucide-react';

/** Put inside a <Link>: a soft pulsing dot (no spinner) while that navigation is loading. */
export function LinkPending({ className = 'size-2' }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <span aria-label="Loading" className={`inline-block animate-pulse rounded-full bg-fg-3 ${className}`} /> : null;
}

/** A row's trailing chevron; pulses instead of spinning while its link is loading. */
export function RowChevron() {
  const { pending } = useLinkStatus();
  return <ChevronRight className={`size-4 flex-none ${pending ? 'animate-pulse text-fg-2' : 'text-fg-4'}`} />;
}
