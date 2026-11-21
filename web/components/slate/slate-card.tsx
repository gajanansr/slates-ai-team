import Link from 'next/link';
import { ChevronRight, Pin } from 'lucide-react';
import type { Slate } from '@/lib/kinds';
import { SlateBody } from '@/components/slate/slate-body';
import { BoardIcon } from '@/components/board-icon';
import { Ago } from '@/components/time';

export function SlateMeta({ slate }: { slate: Slate }) {
  return (
    <span className="text-xs text-fg-4">
      {slate.updated_by_name ? <span className="text-fg-3">{slate.updated_by_name}</span> : 'You'} · <Ago iso={slate.updated_at} />
    </span>
  );
}

export function SlateCard({ slate, className = '' }: { slate: Slate; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`} aria-labelledby={`t-${slate.id}`}>
      <Link href={`/s/${slate.slug}`} className="group -mx-1 -mt-1 mb-3 flex items-center gap-2.5 rounded-xl px-1 py-1">
        <BoardIcon name={slate.icon} kind={slate.kind} className="size-4 text-fg-3" />
        <h2 id={`t-${slate.id}`} className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
          {slate.title}
        </h2>
        {slate.pinned && <Pin className="size-3.5 text-fg-4" strokeWidth={1.75} aria-label="Pinned" />}
        <ChevronRight className="size-4 text-fg-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
      <SlateBody slate={slate} mode="card" />
      <div className="mt-4 border-t border-line pt-3">
        <SlateMeta slate={slate} />
      </div>
    </section>
  );
}
