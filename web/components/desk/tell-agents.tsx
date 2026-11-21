'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowUp, AtSign, Bot, Check, X } from 'lucide-react';
import { agentNames, removeDeskItem, tellAgents } from '@/app/(app)/desk-actions';
import type { DeskTarget } from '@/lib/desk';

export type Told = { id: string; text: string; open: boolean; reply?: string; to?: string };

const flat = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
const TAG = /(@[a-z0-9][a-z0-9_-]{0,29})/gi;

/** Text with its @tags drawn as small pills, so a tag reads as a person, not as typing. */
function WithTags({ text }: { text: string }) {
  return (
    <>
      {text.split(TAG).map((part, i) =>
        /^@[a-z0-9]/i.test(part) ? (
          <span key={i} className="mx-px inline-block rounded-full bg-accent px-2 py-px text-[13px] font-semibold leading-snug text-on-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Leave a task for your agents about this board or note. Type @ to pick an agent: it picks the
 * task up, does it, and replies here. Without a tag, whichever agent connects next takes it.
 */
export function TellAgents({ target, path, told = [] }: { target: DeskTarget; path: string; told?: Told[] }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [agents, setAgents] = useState<string[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let live = true;
    agentNames().then((n) => live && setAgents(n));
    return () => {
      live = false;
    };
  }, []);

  // The tab bar stays. While the field is focused there is extra room under it, so the page can
  // scroll the field above the bar; when the keyboard closes the field lets go and the room goes.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !focused) return;
    let last = vv.height;
    const onResize = () => {
      if (vv.height > last + 100) input.current?.blur();
      last = vv.height;
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [focused]);

  const matches = useMemo(() => (query === null ? [] : agents.filter((a) => flat(a).startsWith(flat(query)))), [agents, query]);

  // The @word the caret is in, if any.
  const sense = (value: string, caret: number) => {
    const m = /(^|\s)@([a-z0-9_-]*)$/i.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
  };

  const pick = (name: string) => {
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([a-z0-9_-]*)$/i, '');
    const after = text.slice(caret);
    const next = `${before}@${flat(name)} ${after.replace(/^\s+/, '')}`;
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length + flat(name).length + 2;
      el?.setSelectionRange(pos, pos);
    });
  };

  const pickedUp = (to?: string) => (to ? to.split(',').map((x) => `@${x}`).join(' ') : 'an agent');

  return (
    <section className="mt-6" aria-labelledby="tell-h">
      <h2 id="tell-h" className="kicker mb-2 px-1">For your agents</h2>
      {told.length > 0 && (
        <ul className="card mb-2 divide-y divide-line">
          {told.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-3.5 py-3">
              <span className="mt-0.5 grid size-7 flex-none place-items-center rounded-full bg-muted text-fg-3">{t.open ? <Bot className="size-3.5" strokeWidth={1.8} /> : <Check className="size-3.5" strokeWidth={2.2} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] leading-snug [overflow-wrap:anywhere]"><WithTags text={t.text} /></span>
                <span className="block text-[12px] text-fg-3 [overflow-wrap:anywhere]">{t.open ? `Waiting for ${pickedUp(t.to)} to pick it up` : t.reply}</span>
              </span>
              <button type="button" aria-label="Remove" disabled={pending} onClick={() => start(async () => void (await removeDeskItem(t.id, path)))} className="grid size-8 flex-none place-items-center rounded-full text-fg-4 active:bg-muted">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        ref={box}
        className="relative flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setError('');
          setQuery(null);
          start(async () => {
            const r = await tellAgents(t, target, path);
            if (r.ok) setText('');
            else setError(r.error);
          });
        }}
      >
        {matches.length > 0 && (
          <ul role="listbox" aria-label="Agents" className="card absolute inset-x-0 bottom-[calc(100%+8px)] z-20 max-h-56 overflow-y-auto p-1.5 shadow-[var(--shadow-float)]">
            {matches.map((a) => (
              <li key={a} role="option" aria-selected="false">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)} className="flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left active:bg-muted">
                  <span className="grid size-7 flex-none place-items-center rounded-full bg-accent text-on-accent">
                    <AtSign className="size-3.5" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{a}</span>
                  <span className="text-[12px] text-fg-4">@{flat(a)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            sense(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => sense(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
          onFocus={() => {
            setFocused(true);
            setTimeout(() => box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
          }}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setQuery(null), 120);
          }}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
          aria-label="Task for your agents"
          placeholder={`Type @ to tag an agent`}
          className="field h-11 min-w-0 flex-1 text-[15px]"
        />
        <button type="submit" disabled={pending || !text.trim()} aria-label="Send to agents" className={`grid size-11 flex-none place-items-center rounded-full bg-accent text-on-accent disabled:opacity-40 ${pending ? 'animate-pulse' : ''}`}>
          <ArrowUp className="size-[18px]" strokeWidth={2.2} />
        </button>
      </form>
      {error && <p className="mt-2 px-1 text-sm text-fg">{error}</p>}
      <div aria-hidden style={{ height: focused ? 'calc(var(--tabbar-h) + 72px)' : 0 }} />
    </section>
  );
}
