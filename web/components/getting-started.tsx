'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Check, ChevronRight, LayoutGrid, Sun, X } from 'lucide-react';

const KEY = 'slates-getting-started-hidden';

/**
 * First-run guide on Home: three steps that make Slates useful, each ticking itself off.
 * Shows instead of "Since you last looked" until done or hidden.
 */
export function GettingStarted({ done, children }: { done: { agent: boolean; board: boolean; automation: boolean }; children: React.ReactNode }) {
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, []);
  const steps = [
    { ok: done.agent, href: '/agents', icon: Bot, title: 'Connect an AI agent', sub: 'Claude, ChatGPT or Gemini. Everything they make for you lands here.' },
    { ok: done.board, href: '/agents', icon: LayoutGrid, title: 'Let it interview you', sub: 'Say “interview me for Slates” to your agent. Two minutes, and your spaces are set up.' },
    { ok: done.automation, href: '/settings/automations', icon: Sun, title: 'Turn on the morning brief', sub: 'Every morning Slates writes today’s plan for you.' },
  ];
  const left = steps.filter((s) => !s.ok).length;
  if (left === 0 || hidden !== false) return <>{children}</>;

  return (
    <section className="rise-3 md:mt-2" aria-labelledby="start-h">
      <div className="mb-2 flex flex-none items-center justify-between gap-3 px-0.5">
        <h2 id="start-h" className="text-[19px] font-medium tracking-[-0.035em]">
          Get started <span className="text-fg-4">· {3 - left}/3</span>
        </h2>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1');
            } catch {}
            setHidden(true);
          }}
          className="flex h-9 items-center gap-1 rounded-full px-2.5 text-[13px] text-fg-3 active:bg-muted"
        >
          <X className="size-3.5" /> Hide
        </button>
      </div>
      <ul className="card divide-y divide-line">
        {steps.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className={`flex items-center gap-3 px-3.5 py-2.5 active:bg-muted ${s.ok ? 'opacity-60' : ''}`}>
              <span className={`grid size-9 flex-none place-items-center rounded-xl ${s.ok ? 'bg-new/15 text-new' : 'bg-accent text-on-accent'}`}>
                {s.ok ? <Check className="size-[18px]" strokeWidth={2.2} /> : <s.icon className="size-[18px]" strokeWidth={1.8} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[14.5px] font-medium ${s.ok ? 'line-through' : ''}`}>{s.title}</span>
                <span className="block truncate text-[12px] text-fg-3">{s.sub}</span>
              </span>
              {!s.ok && <ChevronRight className="size-4 flex-none text-fg-4" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
