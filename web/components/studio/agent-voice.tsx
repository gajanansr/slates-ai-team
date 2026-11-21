'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Pause, Play } from 'lucide-react';

/**
 * An agent's voice in the UI: "Hear <Name>" plays its Murf intro (made on first play when it
 * isn't stored yet), and the picker changes the voice, which saves and makes a new intro.
 * Needs a [data-agent] ancestor for the accent colour.
 */

export type IntroClip = { url: string; text: string };
export type VoiceChoice = { id: string; label: string };

/** "Voice by Murf · Calls by Agora": the two services behind every agent's voice. */
export function PoweredBy({ className = '' }: { className?: string }) {
  return <p className={`text-[12px] text-fg-4 ${className}`}>Voice by Murf · Calls by Agora</p>;
}

async function fetchIntro(slug: string, voice?: string) {
  const res = await fetch(`/api/studio/agents/${encodeURIComponent(slug)}/voice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(voice ? { voice } : {}),
  });
  const j = (await res.json().catch(() => ({}))) as { voice?: string; label?: string; intro?: IntroClip | null; error?: string };
  if (!res.ok) throw new Error(j.error ?? "Couldn't load the voice.");
  return j;
}

/** Five bars that dance while the intro plays; still when reduced motion is on, or when paused. */
function Levels({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden className="flex h-4 items-center gap-[3px]">
      {[0.55, 0.9, 0.7, 1, 0.6].map((h, i) => (
        <span
          key={i}
          className={`voice-bar w-[3px] rounded-full bg-current ${playing ? 'is-playing' : ''}`}
          style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${i * 110}ms` }}
        />
      ))}
    </span>
  );
}

/** The prominent play button. With no stored clip it asks the server to make one, then plays it. */
export function HearButton({ slug, name, intro, onIntro, className = '' }: { slug: string; name: string; intro: IntroClip | null; onIntro?: (c: IntroClip) => void; className?: string }) {
  const [clip, setClip] = useState<IntroClip | null>(intro);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);

  useEffect(() => setClip(intro), [intro]);
  useEffect(() => () => audio.current?.pause(), []);
  // A new clip (new voice) replaces the old one.
  useEffect(() => {
    if (!audio.current || audioUrl.current === clip?.url) return;
    audio.current.pause();
    audio.current = null;
    audioUrl.current = null;
  }, [clip?.url]);

  const play = async () => {
    setError(null);
    if (state === 'playing') {
      audio.current?.pause();
      return setState('idle');
    }
    let c = clip;
    if (!c) {
      setState('loading');
      try {
        const j = await fetchIntro(slug);
        if (!j.intro) throw new Error(j.error ?? "Couldn't make the voice right now.");
        c = j.intro;
        setClip(c);
        onIntro?.(c);
      } catch (e) {
        setState('idle');
        return setError((e as Error).message);
      }
    }
    const a = audio.current && audioUrl.current === c.url ? audio.current : new Audio(c.url);
    audio.current = a;
    audioUrl.current = c.url;
    a.onended = () => setState('idle');
    a.onpause = () => setState('idle');
    a.onerror = () => {
      setState('idle');
      setError("Couldn't play the clip.");
    };
    try {
      a.currentTime = 0;
      await a.play();
      setState('playing');
    } catch {
      setState('idle');
    }
  };

  return (
    <div className={className}>
      <button type="button" onClick={play} aria-pressed={state === 'playing'} className="btn h-11 gap-2.5 bg-[var(--agent)] text-surface">
        {state === 'playing' ? <Pause className="size-4" strokeWidth={2} /> : <Play className="size-4" strokeWidth={2} />}
        <span>{state === 'loading' ? `${name} is warming up…` : state === 'playing' ? `Stop` : `Hear ${name}`}</span>
        <Levels playing={state === 'playing'} />
      </button>
      {state === 'playing' && clip && <p className="sr-only" aria-live="polite">{clip.text}</p>}
      {error && <p role="alert" className="mt-2 text-[13px] text-fg-3">{error}</p>}
    </div>
  );
}

/** Agent home: "Voice: Aarav, Indian English", Hear, and a picker that saves. */
export function AgentVoicePanel({ slug, name, voice, options, intro }: { slug: string; name: string; voice: VoiceChoice; options: VoiceChoice[]; intro: IntroClip | null }) {
  const [current, setCurrent] = useState(voice);
  const [clip, setClip] = useState<IntroClip | null>(intro);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (v: VoiceChoice) => {
    if (v.id === current.id || saving) return setOpen(false);
    setSaving(v.id);
    setError(null);
    try {
      const j = await fetchIntro(slug, v.id);
      setCurrent({ id: j.voice ?? v.id, label: j.label ?? v.label });
      setClip(j.intro ?? null);
      if (j.intro) new Audio(j.intro.url).play().catch(() => {});
      else if (j.error) setError(`Saved. ${j.error}`);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-5 rounded-2xl bg-[var(--agent-soft)] p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <HearButton slug={slug} name={name} intro={clip} onIntro={setClip} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">
            <span className="text-fg-3">Voice:</span> <span className="font-medium">{current.label}</span>
          </p>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="agent-voices" className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--agent)]">
            Change voice <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
          </button>
        </div>
      </div>
      {open && (
        <ul id="agent-voices" role="radiogroup" aria-label={`Voice for ${name}`} className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {options.map((v) => {
            const on = v.id === current.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!!saving}
                  onClick={() => choose(v)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors ${on ? 'bg-surface font-medium' : 'bg-surface/60 hover:bg-surface'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{v.label}</span>
                  {saving === v.id ? <span className="text-[12px] text-fg-3">Saving…</span> : on ? <Check className="size-4 text-[var(--agent)]" strokeWidth={2.2} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-fg-3">{error}</p>}
      <PoweredBy className="mt-3" />
    </div>
  );
}
