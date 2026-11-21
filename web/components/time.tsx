'use client';
import { ago } from '@/lib/time';

/** Relative time rendered in the viewer's clock (server and client may differ by seconds). */
export function Ago({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning title={new Date(iso).toLocaleString()}>
      {ago(iso)}
    </time>
  );
}
