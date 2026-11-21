'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="min-w-0">
      {label && <p className="kicker mb-1.5">{label}</p>}
      <div className="flex items-stretch overflow-hidden rounded-2xl border border-line bg-muted">
        <pre className="no-scrollbar min-w-0 flex-1 overflow-x-auto p-3.5 font-mono text-[12.5px] leading-relaxed text-fg-2 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
          {text}
        </pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }}
          className="grid w-12 shrink-0 place-items-center border-l border-line text-fg-2 transition-colors active:bg-muted"
          aria-label={done ? 'Copied' : 'Copy'}
        >
          {done ? <Check className="size-4" /> : <Copy className="size-4" strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}
