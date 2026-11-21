'use client';
import { Sparkles } from 'lucide-react';
import { openCommand } from '@/components/command';

/** Home's AI button: opens the Ask / search palette (same as Cmd-K). */
export function AiButton({ canAsk, className = '' }: { canAsk: boolean; className?: string }) {
  return (
    <button
      type="button"
      data-tour="ask"
      onClick={openCommand}
      aria-label={canAsk ? 'Ask Slates or search' : 'Search'}
      className={`flex h-11 flex-none items-center gap-1.5 rounded-full bg-accent pl-3 pr-3.5 text-[14px] font-medium text-on-accent shadow-[0_6px_18px_-8px_rgb(0_0_0/0.35)] transition-transform active:scale-95 ${className}`}
    >
      <Sparkles className="size-[17px]" strokeWidth={1.9} />
      {canAsk ? 'Ask' : 'Search'}
    </button>
  );
}
