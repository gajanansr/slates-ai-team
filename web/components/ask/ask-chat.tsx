'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Markdown from 'react-markdown';
import { remarkGfmSafe } from '@/lib/markdown';
import { AlarmClock, ArrowUp, CalendarDays, Inbox, ListPlus, Loader2, Mic, Sparkles, Square, Wallet, Wrench } from 'lucide-react';

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; error?: boolean };
const ASK_KEY = 'slates-ask-chat';
/** Earlier chats, newest first. Kept on this device only. */
const PAST_KEY = 'slates-ask-past';
type Past = { id: string; title: string; at: number; turns: Turn[] };
const readPast = (): Past[] => {
  try {
    const p = JSON.parse(localStorage.getItem(PAST_KEY) ?? '[]');
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

const SUGGESTIONS = [
  { text: "What's due this week?", icon: CalendarDays },
  { text: 'Add milk to groceries', icon: ListPlus },
  { text: 'How much did I spend this month?', icon: Wallet },
  { text: 'File my inbox', icon: Inbox },
  { text: 'Remind me at 6pm to call the bank', icon: AlarmClock },
];

/** The assistant's mark: a small accent disc with a sparkle. */
const Mark = ({ busy = false }: { busy?: boolean }) => (
  <span aria-hidden className={`grid size-7 flex-none place-items-center rounded-full bg-accent text-on-accent ${busy ? 'animate-pulse' : ''}`}>
    <Sparkles className="size-[15px]" strokeWidth={2} />
  </span>
);

/** Ask Slates: a chat that can read and change everything, by typing or talking. */
export function AskChat({ ready }: { ready: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recog = useRef<any>(null);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // The conversation stays on this device, so leaving Ask and coming back picks up where you were.
  const restored = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ASK_KEY) ?? '[]');
      if (Array.isArray(saved) && saved.length) setTurns(saved.filter((t) => t && typeof t.content === 'string' && (t.role === 'user' || t.role === 'assistant')));
    } catch {
      /* private mode or bad data: start fresh */
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current || busy) return;
    try {
      const keep = turns.filter((t) => !t.error && t.content).slice(-40);
      if (keep.length) localStorage.setItem(ASK_KEY, JSON.stringify(keep));
      else localStorage.removeItem(ASK_KEY);
    } catch {
      /* storage full or blocked: the chat still works */
    }
  }, [turns, busy]);
  const [past, setPast] = useState<Past[]>([]);
  const [showPast, setShowPast] = useState(false);
  useEffect(() => setPast(readPast()), []);
  /** File the open chat under its first question, then start (or reopen) another. */
  const shelve = (next: Turn[]) => {
    abort.current?.abort();
    const keep = turns.filter((t) => !t.error && t.content);
    let list = readPast();
    if (keep.length) {
      const title = (keep.find((t) => t.role === 'user')?.content ?? 'Chat').slice(0, 80);
      list = [{ id: `${Date.now()}`, title, at: Date.now(), turns: keep.slice(-40) }, ...list.filter((p) => p.title !== title)].slice(0, 20);
    }
    try {
      localStorage.setItem(PAST_KEY, JSON.stringify(list));
    } catch {
      /* storage full: the newest chats still show this session */
    }
    setPast(list);
    setShowPast(false);
    setTurns(next);
  };
  const newChat = () => shelve([]);
  const reopen = (p: Past) => {
    const rest = readPast().filter((x) => x.id !== p.id);
    try {
      localStorage.setItem(PAST_KEY, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
    shelve(p.turns);
  };

  // Braces matter: newer browsers return a Promise from scrollIntoView, and React would call it as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const history = [...turns.filter((t) => !t.error), { role: 'user' as const, content: q }];
    setTurns([...history, { role: 'assistant', content: '', tools: [] }]);
    setBusy(true);
    abort.current = new AbortController();
    const patch = (fn: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    let changed = false;
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? (res.status === 504 ? 'That took too long. Try again.' : `Something went wrong (${res.status}).`));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === 'text') patch((t) => ({ ...t, content: t.content + e.text }));
          else if (e.type === 'tool') {
            if (!/^(list|get|find|describe|recent|slate_history|what_changed|Search)/.test(e.name)) changed = true;
            patch((t) => ({ ...t, tools: [...(t.tools ?? []), e.title] }));
          } else if (e.type === 'meta') {
            if (e.changed) changed = true;
            if (typeof e.left === 'number') setLeft(e.left);
          } else if (e.type === 'error') throw new Error(e.message);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') patch((t) => ({ ...t, content: t.content || e.message, error: !t.content }));
    } finally {
      setBusy(false);
      if (changed) router.refresh();
    }
  };

  useEffect(() => {
    const q = params.get('q');
    if (q && !started.current && ready) {
      started.current = true;
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, ready]);

  const [SR, setSR] = useState<any>(null);
  useEffect(() => {
    setSR(() => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);
  }, []);
  const talk = () => {
    if (listening) return recog.current?.stop();
    if (!SR) return;
    const r = new SR();
    r.lang = navigator.language || 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    let final = '';
    r.onresult = (ev: any) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
        else interim += ev.results[i][0].transcript;
      }
      setInput((final + interim).trim());
    };
    r.onend = () => {
      setListening(false);
      if (final.trim()) send(final);
    };
    r.onerror = () => setListening(false);
    recog.current = r;
    setListening(true);
    r.start();
  };

  if (!ready) {
    return (
      <div className="card p-5 text-center">
        <Sparkles className="mx-auto mb-3 size-6 text-fg-3" strokeWidth={1.6} />
        <p className="text-[15px] font-medium">Ask Slates is almost here</p>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-sm text-fg-3">It needs an AI key on the server (a free Gemini key works). Once it&apos;s added, you can ask about and change anything here by typing or talking.</p>
      </div>
    );
  }

  return (
    // Phones: a fixed frame (see .ask-screen); only the messages scroll. Desktop: the page scrolls.
    <div className="flex min-h-0 flex-1 flex-col md:min-h-[calc(100dvh-260px)]">
      <div className="ask-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-1 pb-4 pt-4 md:pt-0 md:overflow-visible">
        {(turns.length > 0 || past.length > 0) && (
          <div className="-mb-2 flex flex-none justify-center gap-2">
            {turns.length > 0 && (
              <button type="button" onClick={newChat} className="rounded-full bg-muted px-3.5 py-1.5 text-[12.5px] font-medium text-fg-2 active:scale-95">
                New chat
              </button>
            )}
            {past.length > 0 && (
              <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="rounded-full bg-muted px-3.5 py-1.5 text-[12.5px] font-medium text-fg-2 active:scale-95">
                {showPast ? 'Hide earlier chats' : `Earlier chats · ${past.length}`}
              </button>
            )}
          </div>
        )}
        {showPast && (
          <ul className="card flex-none divide-y divide-line">
            {past.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => reopen(p)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-muted">
                  <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.title}</span>
                  <span className="flex-none text-[12px] text-fg-4">{new Date(p.at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {turns.length === 0 && (
          <div className="mt-auto md:mt-0 md:pt-2">
            <div className="mb-5 flex items-center gap-3">
              <span aria-hidden className="grid size-12 flex-none place-items-center rounded-[18px] bg-accent text-on-accent shadow-[0_8px_24px_-10px_var(--accent)]">
                <Sparkles className="size-6" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="text-[17px] font-medium tracking-[-0.02em]">What can I do for you?</p>
                <p className="text-[13.5px] text-fg-3">Ask about your boards, notes and reminders, or tell me what to change.</p>
              </div>
            </div>
            <div className="grid gap-2">
              {SUGGESTIONS.map(({ text, icon: I }) => (
                <button key={text} type="button" onClick={() => send(text)} className="flex h-12 items-center gap-3 rounded-2xl bg-muted px-4 text-left text-[14.5px] transition-transform active:scale-[0.98]">
                  <I className="size-[18px] flex-none text-fg-3" strokeWidth={1.7} />
                  <span className="min-w-0 truncate">{text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-md bg-btn px-4 py-2.5 text-[15px] text-on-btn [overflow-wrap:anywhere]">
              {t.content}
            </p>
          ) : (
            <div key={i} className="flex max-w-[94%] gap-2.5">
              <Mark busy={busy && i === turns.length - 1} />
              <div className="min-w-0 flex-1 pt-0.5">
                {t.tools && t.tools.length > 0 && (
                  <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
                    <Wrench className="size-3" strokeWidth={1.8} />
                    {[...new Set(t.tools)].join(' · ')}
                  </p>
                )}
                {t.content ? (
                  <div className={`prose-slate text-[15px] ${t.error ? 'text-fg-3' : ''}`}>
                    <Markdown remarkPlugins={[remarkGfmSafe]} components={{ a: ({ node: _n, ...p }) => <a {...p} target={p.href?.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" /> }}>
                      {t.content}
                    </Markdown>
                  </div>
                ) : (
                  busy && i === turns.length - 1 && <Loader2 className="mt-1 size-4 animate-spin text-fg-3" />
                )}
              </div>
            </div>
          ),
        )}
        {left !== null && left <= 5 && <p className="text-center text-[12px] text-fg-4">{left} AI question{left === 1 ? '' : 's'} left today · quick actions are unlimited</p>}
        <div ref={end} />
      </div>

      <form
        className="flex flex-none items-end gap-2 rounded-[26px] bg-surface p-1.5 shadow-[var(--shadow-float)] md:sticky md:bottom-6"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {SR && (
          <button type="button" onClick={talk} aria-label={listening ? 'Stop listening' : 'Talk'} aria-pressed={listening} className={`grid size-11 flex-none place-items-center rounded-full ${listening ? 'animate-pulse bg-accent text-on-accent' : 'bg-muted'}`}>
            <Mic className="size-[18px]" strokeWidth={1.8} />
          </button>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder={listening ? 'Listening…' : 'Ask or add anything'}
          aria-label="Ask Slates"
          enterKeyHint="send"
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[16px] outline-none placeholder:text-fg-4"
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="grid size-11 flex-none place-items-center rounded-full bg-btn text-on-btn">
            <Square className="size-4" fill="currentColor" />
          </button>
        ) : (
          <button aria-label="Send" disabled={!input.trim()} className="grid size-11 flex-none place-items-center rounded-full bg-btn text-on-btn disabled:opacity-40">
            <ArrowUp className="size-[18px]" strokeWidth={2} />
          </button>
        )}
      </form>
    </div>
  );
}
