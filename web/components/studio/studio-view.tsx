'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Bell, Check, ChevronRight, Dumbbell, LayoutGrid, Mic, NotebookPen, RefreshCw, Rocket, Repeat, Tag, Milk } from 'lucide-react';
import { AgentMark } from '@/components/studio/agent-mark';
import { HearButton, PoweredBy, type IntroClip } from '@/components/studio/agent-voice';
import type { AgentColor } from '@/lib/studio/blueprint';
import type { BuildEvent, PieceKind } from '@/lib/studio/build';

export type StudioAgent = { slug: string; name: string; icon: string; color: AgentColor; mission: string; boards: number; routines: number };

const SUGGESTIONS = [
  { text: 'Manage my dairy business', fill: 'Manage my dairy business', Icon: Milk },
  { text: 'Find me the best deals on…', fill: 'Find me the best deals on ', Icon: Tag },
  { text: 'Track my fitness goals', fill: 'Track my fitness goals', Icon: Dumbbell },
  { text: 'Run my side-project launch', fill: 'Run my side-project launch', Icon: Rocket },
] as const;

const GROUPS: { piece: PieceKind; label: string; Icon: typeof LayoutGrid }[] = [
  { piece: 'board', label: 'Boards', Icon: LayoutGrid },
  { piece: 'routine', label: 'Routines', Icon: Repeat },
  { piece: 'reminder', label: 'Reminders', Icon: Bell },
  { piece: 'note', label: 'Notes', Icon: NotebookPen },
];

type Piece = { piece: PieceKind; title: string; status?: string; detail?: string };
export type Build = {
  stage: string;
  agent?: { name: string; icon: string; color: AgentColor; mission: string };
  pieces: Piece[];
  done?: { slug: string; url: string; summary: string };
  /** Its spoken intro (Murf), streamed after done. */
  intro?: IntroClip & { label: string };
  error?: string;
};

const STATUS_LABEL: Record<string, string> = { created: 'Added', kept: 'Already there', scheduled: 'Runs automatically', recorded: 'In its playbook' };

/**
 * Agent Studio: say what you want run, watch the agent come together piece by piece, then open it.
 */
export function StudioView({ agents, ready, left, preview }: { agents: StudioAgent[]; ready: boolean; left: number; /** Dev harness only: start in this build state. */ preview?: Build & { busy?: boolean } }) {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [details, setDetails] = useState('');
  const [build, setBuild] = useState<Build | null>(preview ?? null);
  const [busy, setBusy] = useState(preview?.busy ?? false);
  const [listening, setListening] = useState(false);
  const [SR, setSR] = useState<any>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const recog = useRef<any>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setSR(() => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);
    return () => abort.current?.abort();
  }, []);

  const start = async (text = goal) => {
    const g = text.trim();
    if (g.length < 3 || busy) return;
    setBusy(true);
    setBuild({ stage: 'Reading what you need', pieces: [] });
    abort.current = new AbortController();
    const apply = (e: BuildEvent) =>
      setBuild((b) => {
        if (!b) return b;
        switch (e.type) {
          case 'stage':
            return { ...b, stage: e.text };
          case 'blueprint':
            return { ...b, agent: { name: e.name, icon: e.icon, color: e.color, mission: e.mission }, pieces: e.pieces.map((p) => ({ ...p })) };
          case 'piece': {
            const i = b.pieces.findIndex((p) => p.piece === e.piece && !p.status && p.title === e.title);
            const next = { piece: e.piece, title: e.title, status: e.status, detail: e.detail };
            return { ...b, pieces: i >= 0 ? b.pieces.with(i, next) : [...b.pieces, next] };
          }
          case 'done':
            return { ...b, done: e, stage: 'Ready' };
          case 'intro':
            return { ...b, intro: { url: e.url, text: e.text, label: e.label } };
          case 'error':
            return { ...b, error: e.message };
        }
      });
    let finished: string | null = null;
    try {
      const res = await fetch('/api/studio/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: g, details: details.trim() || undefined }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? (res.status === 504 ? 'That took too long. Try again: what was built is kept.' : `Something went wrong (${res.status}).`));
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
          const e = JSON.parse(line) as BuildEvent;
          apply(e);
          if (e.type === 'done') finished = e.url;
        }
      }
      if (!finished) setBuild((b) => (b && !b.error ? { ...b, error: 'The build stopped before it finished. Try again: what was built is kept.' } : b));
    } catch (e: any) {
      if (e?.name !== 'AbortError') setBuild((b) => ({ ...(b ?? { stage: '', pieces: [] }), error: e?.message ?? 'Something went wrong.' }));
    } finally {
      setBusy(false);
    }
    // Stay on the finish screen so they can hear the new agent introduce itself; Open goes to its home.
    if (finished) router.refresh();
  };

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
      // "Hey Slates, manage my dairy business" -> "Manage my dairy business"
      const said = (final + interim).replace(/^\s*(?:hey|hi|ok)\s+slates[\s,.!:]*/i, '').trim();
      setGoal(said ? said[0].toUpperCase() + said.slice(1) : '');
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recog.current = r;
    setListening(true);
    r.start();
  };

  if (build) return <Building build={build} busy={busy} onRetry={() => start()} onBack={() => setBuild(null)} />;

  return (
    <div className="space-y-8">
      <section className="card rise-2 p-4 sm:p-6">
        <label htmlFor="studio-goal" className="block text-[19px] font-medium tracking-[-0.03em] sm:text-[22px]">
          What should your new agent do?
        </label>
        <p className="mt-1 text-[13.5px] text-fg-3">Say it the way you would to a person. Slates builds its boards, routines, reminders and notes.</p>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div className="flex items-end gap-2 rounded-[22px] bg-muted p-2 pl-4">
            <textarea
              id="studio-goal"
              ref={input}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  start();
                }
              }}
              rows={2}
              maxLength={300}
              placeholder="Manage my dairy business"
              enterKeyHint="go"
              className="min-h-[52px] min-w-0 flex-1 resize-none bg-transparent py-2 text-[17px] leading-snug outline-none placeholder:text-fg-4"
            />
            {SR && (
              <button
                type="button"
                onClick={talk}
                aria-label={listening ? 'Stop listening' : 'Speak'}
                aria-pressed={listening}
                className={`relative grid size-11 flex-none place-items-center rounded-full transition-colors ${listening ? 'bg-btn text-on-btn' : 'text-fg-2 active:bg-surface'}`}
              >
                {listening && <span aria-hidden className="studio-breathe absolute inset-0 rounded-full bg-btn" />}
                <Mic className="relative size-5" strokeWidth={1.8} />
              </button>
            )}
            <button type="submit" disabled={!ready || left <= 0 || goal.trim().length < 3} aria-label="Build the agent" className="grid size-11 flex-none place-items-center rounded-full bg-btn text-on-btn transition-opacity disabled:opacity-35">
              <ArrowUp className="size-5" strokeWidth={2} />
            </button>
          </div>
          <details className="group mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-1 py-1.5 text-[13px] text-fg-3 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" strokeWidth={1.8} />
              Add details (optional)
            </summary>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={1500}
              placeholder="E.g. 14 cows, two delivery routes, about 60 customers who pay monthly"
              className="field mt-1 h-auto w-full resize-none py-3 text-[15px]"
            />
          </details>
        </form>

        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Ideas">
          {SUGGESTIONS.map(({ text, fill, Icon }, i) => (
            <li key={text} className="enter" style={{ animationDelay: `${80 + i * 40}ms` }}>
              <button
                type="button"
                onClick={() => {
                  setGoal(fill);
                  requestAnimationFrame(() => {
                    input.current?.focus();
                    input.current?.setSelectionRange(fill.length, fill.length);
                  });
                }}
                className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13.5px] text-fg-2 transition-transform active:scale-95"
              >
                <Icon className="size-4 text-fg-3" strokeWidth={1.7} />
                {text}
              </button>
            </li>
          ))}
        </ul>
        {!ready ? (
          <p className="note mt-4">Agent Studio needs an AI key on the server, the same one Ask Slates uses. Once it is added, you can build agents here.</p>
        ) : left <= 0 ? (
          <p className="note mt-4">You have built 5 agents today, the most for one day. You can build more tomorrow.</p>
        ) : null}
      </section>

      <PoweredBy className="-mt-5 px-1" />

      <section className="rise-3">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h2 className="text-[19px] font-medium tracking-[-0.03em]">Your agents</h2>
          {agents.length > 0 && <span className="text-[12.5px] text-fg-3">{agents.length}</span>}
        </div>
        {agents.length === 0 ? (
          <p className="card px-4 py-5 text-[14px] text-fg-3">Agents you build appear here. Each one gets its own space, so its boards and notes stay together.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {agents.map((a, i) => (
              <li key={a.slug} className="enter" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <Link href={`/agents/studio/${a.slug}`} transitionTypes={['nav-forward']} data-agent={a.color} className="card agent-glow press flex items-start gap-3.5 p-4">
                  <AgentMark icon={a.icon} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-medium tracking-[-0.02em]">{a.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-fg-3">{a.mission}</p>
                    <p className="mt-2 text-[12px] text-fg-3">
                      {a.boards} board{a.boards === 1 ? '' : 's'}
                      {a.routines > 0 && ` · ${a.routines} routine${a.routines === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 size-4 flex-none text-fg-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Building({ build, busy, onRetry, onBack }: { build: Build; busy: boolean; onRetry: () => void; onBack: () => void }) {
  const a = build.agent;
  const doneCount = build.pieces.filter((p) => p.status).length;
  return (
    <section data-agent={a?.color ?? 'green'} className="space-y-4" aria-live="polite" aria-busy={busy}>
      <div className={`card p-5 sm:p-6 ${a ? 'agent-glow' : ''}`}>
        <div className="flex items-center gap-4">
          {a ? (
            <span className="relative">
              {busy && <span aria-hidden className="studio-breathe absolute -inset-1.5 rounded-[26px] bg-[var(--agent)]" />}
              <AgentMark icon={a.icon} size="lg" />
            </span>
          ) : (
            <span className="relative grid size-16 flex-none place-items-center">
              <span aria-hidden className="studio-breathe absolute inset-0 rounded-[24px] bg-fg-4" />
              <span className="relative size-16 rounded-[24px] bg-muted" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="kicker mb-1.5">{build.error ? 'Stopped' : build.done ? 'Ready' : build.stage}</p>
            {a ? (
              <>
                <h2 className="studio-pop truncate text-[26px] font-medium leading-tight tracking-[-0.04em]">{a.name}</h2>
                <p className="studio-pop mt-0.5 text-[14px] leading-snug text-fg-2">{a.mission}</p>
              </>
            ) : (
              <div className="space-y-2">
                <div className="h-6 w-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                <div className="h-4 w-56 max-w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              </div>
            )}
          </div>
        </div>
        {build.pieces.length > 0 && (
          <div className="mt-5 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={build.pieces.length} aria-valuenow={doneCount} aria-label="Built so far">
            <div className="h-full rounded-full bg-[var(--agent)] transition-[width] duration-500 ease-out" style={{ width: `${Math.round((doneCount / build.pieces.length) * 100)}%` }} />
          </div>
        )}
      </div>

      {build.pieces.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {GROUPS.map(({ piece, label, Icon }) => {
            const items = build.pieces.filter((p) => p.piece === piece);
            if (!items.length) return null;
            return (
              <div key={piece} className="card p-4">
                <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg-2">
                  <Icon className="size-4 text-[var(--agent)]" strokeWidth={1.8} /> {label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((p, i) => (
                    <li key={`${p.title}-${i}`} className={`flex items-center gap-2.5 py-1.5 ${p.status ? 'studio-pop' : ''}`}>
                      <span className={`grid size-5 flex-none place-items-center rounded-full transition-colors ${p.status ? 'bg-[var(--agent)] text-surface' : 'border border-line'}`}>
                        {p.status ? <Check className="size-3" strokeWidth={3} /> : busy ? <span className="size-1.5 animate-pulse rounded-full bg-fg-4 motion-reduce:animate-none" /> : null}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-[14.5px] ${p.status ? '' : 'text-fg-3'}`}>{p.title}</span>
                      {p.status && <span className="flex-none text-[11.5px] text-fg-3">{STATUS_LABEL[p.status] ?? ''}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {build.error ? (
        <div className="card p-4">
          <p className="text-[14px] text-fg-2">{build.error}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onRetry} disabled={busy} className="btn btn-primary h-11">
              <RefreshCw className="size-4" strokeWidth={1.8} /> Try again
            </button>
            <button type="button" onClick={onBack} className="btn btn-ghost h-11">Change it</button>
          </div>
        </div>
      ) : build.done ? (
        <div className="card studio-pop space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <HearButton slug={build.done.slug} name={a?.name ?? 'your agent'} intro={build.intro ?? null} />
            {build.intro && <span className="text-[13px] text-fg-3">Voice: {build.intro.label}</span>}
          </div>
          <Link href={build.done.url} className="btn btn-primary h-12 w-full">
            Open {a?.name ?? 'your agent'} <ArrowRight className="size-4" />
          </Link>
        </div>
      ) : null}
      <PoweredBy className="px-1" />
    </section>
  );
}
