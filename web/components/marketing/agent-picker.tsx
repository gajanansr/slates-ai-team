'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CopyBlock } from '@/components/copy';

export type PickerAgent = {
  id: string;
  name: string;
  way: string;
  steps: string[];
  note?: string;
  blocks: { label: string; text: string }[];
  more?: { label: string; text: string }[];
};

/**
 * Logo for an agent. Looks for an official mark at /agents/<id>.svg (drop the files into public/agents/);
 * until it exists, or if it fails to load, a neutral monogram is shown instead.
 */
function AgentMark({ id, name, className = 'size-8' }: { id: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`grid flex-none place-items-center overflow-hidden rounded-xl border border-line bg-muted ${className}`} aria-hidden>
      {broken ? (
        <span className="text-[13px] font-semibold text-fg-2">{name.trim().charAt(0).toUpperCase()}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/agents/${id}.svg`} alt="" className="size-[70%] object-contain" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

/** "Choose your agent" as a dropdown with logos, then only that agent's instructions. */
export function AgentPicker({ agents }: { agents: PickerAgent[] }) {
  const [id, setId] = useState(agents[0].id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const a = agents.find((x) => x.id === id) ?? agents[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div>
      <p className="kicker mb-2" id="agent-pick-l">
        Choose your agent
      </p>
      <div ref={box} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="agent-pick-l"
          onClick={() => setOpen((v) => !v)}
          className="flex h-14 w-full items-center gap-3 rounded-2xl border border-line bg-muted px-3 text-left transition-colors active:bg-line"
        >
          <AgentMark id={a.id} name={a.name} className="size-9" />
          <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-fg">{a.name}</span>
          <ChevronDown className={`size-5 flex-none text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <ul role="listbox" aria-labelledby="agent-pick-l" className="glass-strong absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-[min(22rem,60vh)] overflow-y-auto rounded-2xl border border-line p-1.5 shadow-[var(--shadow-float)]">
            {agents.map((x) => (
              <li key={x.id} role="option" aria-selected={x.id === id}>
                <button
                  type="button"
                  onClick={() => {
                    setId(x.id);
                    setOpen(false);
                  }}
                  className={`flex h-12 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[15px] active:bg-muted ${x.id === id ? 'bg-muted font-medium' : ''}`}
                >
                  <AgentMark id={x.id} name={x.name} />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  {x.id === id && <Check className="size-4 flex-none text-fg-3" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card mt-4 space-y-4 p-5" aria-live="polite" aria-label={`${a.name} instructions`}>
        <div>
          <p className="text-[20px] font-medium tracking-[-0.03em] text-fg">Connect {a.name}</p>
          <p className="mt-1 text-[13px] text-fg-3">{a.way}</p>
        </div>
        <ol className="space-y-2.5">
          {a.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 flex-none place-items-center rounded-full border border-line font-mono text-[11px] text-fg-3">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
        {a.blocks.map((b) => (
          <CopyBlock key={b.label} label={b.label} text={b.text} />
        ))}
        {a.note && <p className="text-[13px] text-fg-3">{a.note}</p>}
        {a.more && a.more.length > 0 && (
          <details className="rounded-2xl border border-line p-3">
            <summary className="cursor-pointer text-[14px] font-medium text-fg">Other ways to connect {a.name}</summary>
            <div className="mt-3 space-y-3">
              {a.more.map((b) => (
                <CopyBlock key={b.label} label={b.label} text={b.text} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
