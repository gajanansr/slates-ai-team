import { Bot } from 'lucide-react';
import { ConnectAgent } from '@/components/agents/connect-agent';

/** Shown on Home until the first agent is connected: the one thing that makes Slates come alive. */
export function ConnectCard() {
  return (
    <section className="card rise-2 mb-4 flex flex-none items-center gap-3 p-3.5" aria-label="Connect an agent">
      <span className="grid size-11 flex-none place-items-center rounded-2xl bg-accent text-on-accent">
        <Bot className="size-5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium tracking-[-0.02em]">Connect your first agent</p>
        <p className="text-[12.5px] leading-snug text-fg-3">One paste. It interviews you for two minutes and sets up your spaces.</p>
      </div>
      <ConnectAgent cta="Connect" />
    </section>
  );
}
