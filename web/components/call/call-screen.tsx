'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Users } from 'lucide-react';
import type { IAgoraRTCClient, IMicrophoneAudioTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import { Logo } from '@/components/logo';
import { BARGE_START, bargeConfig, bargeStep, type BargeState } from '@/lib/barge-in';
import { AgentMark } from '@/components/studio/agent-mark';

type Caption = { who: string; text: string };
type Phase = 'idle' | 'connecting' | 'live' | 'ended';
type Mode = 'call' | 'standup';
/** An Agent Studio agent hosting the call instead of Slates (/call?agent=<slug>). */
export type CallAgent = { slug: string; name: string; icon: string; color: string };
type Participant = { uid: number; name: string; line: string; live?: boolean };
type Narrated = { name: string; line: string };
type AgentStatus = 'idle' | 'thinking' | 'speaking';
/** From the runner's meeting room, through /api/call/captions: each live agent's status and who has the floor. */
type RoomView = { floor: { who: string; since: number } | null; status: Record<string, AgentStatus> };
type Started = {
  appId: string;
  channel: string;
  rtcToken: string;
  uid: number;
  callRef: string;
  participants?: Participant[];
  standup?: { order: number[]; reports: Narrated[] };
};
/** The voice the standup waits on: who, since when, and whether it has been heard yet. */
type Turn = { step: number; uid: number; since: number; spoke: boolean; startedAt?: number };

const AGENT_UID = 1000;
/** Remote level above this counts as speaking; a voice stays "speaking" for HOLD_MS after. */
const SPEAKING_LEVEL = 0.04;
const HOLD_MS = 650;
/** Standup safety nets: a voice that never starts (failed speak, greeting late) or never stops. */
const GREETING_WAIT_MS = 15000;
const START_WAIT_MS = 15000; // a cast voice's first words can take a while (TTS warm-up)
// A turn ends only after this much real silence: Murf streams speech in chunks with short gaps between sentences.
const TURN_QUIET_MS = 1600;
const MIN_TURN_MS = 2500;
const MAX_TURN_MS = 45000;
const CLOSING = 'What should the team do next?';
const LAST_STANDUP = 'slates.lastStandup';
/** Barge-in: your level above this for this long, while an agent talks, stops everyone (configurable at build time). */
const BARGE = bargeConfig(process.env.NEXT_PUBLIC_CALL_BARGE_LEVEL, process.env.NEXT_PUBLIC_CALL_BARGE_MS);
const FLOOR_NOTE_MS = 2500;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** What Slates said, minus the greeting, the standup script and the goodbye: a short "Slates did" summary. */
function summaryOf(captions: Caption[]) {
  const closing = captions.map((c) => c.text.includes(CLOSING)).lastIndexOf(true);
  const after = closing >= 0 ? captions.slice(closing + 1) : captions.slice(1);
  const lines = after.filter((c) => c.who === 'Slates').map((c) => c.text);
  return lines.filter((t) => !/^goodbye\b/i.test(t.trim())).slice(-3);
}

export function CallScreen({ ready, initialMode = 'call', agent }: { ready: boolean; initialMode?: Mode; agent?: CallAgent }) {
  const hostName = agent?.name ?? 'Slates';
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(ready ? null : "Calling isn't set up yet.");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [levels, setLevels] = useState<{ byUid: Record<number, number>; talking: Record<number, boolean>; me: number; anyTalking: boolean; scripted: boolean }>({
    byUid: {},
    talking: {},
    me: 0,
    anyTalking: false,
    scripted: false,
  });
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reports, setReports] = useState<Narrated[]>([]);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [floorNote, setFloorNote] = useState(false);

  const client = useRef<IAgoraRTCClient | null>(null);
  const mic = useRef<IMicrophoneAudioTrack | null>(null);
  const remotes = useRef(new Map<number, IRemoteAudioTrack>());
  const loudAt = useRef(new Map<number, number>());
  const callRef = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const mutedRef = useRef(false);
  const capsEl = useRef<HTMLDivElement>(null);
  // Standup: whose uid speaks at each step, how far we got, and the voice we wait on.
  const order = useRef<number[]>([]);
  const step = useRef(-1);
  const turn = useRef<Turn | null>(null);
  const advancing = useRef(false);
  const barge = useRef<BargeState>(BARGE_START);
  const floorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Tell the server the call is over (agents leave, token revoked). Fire and forget. */
  const notifyEnd = useCallback((beacon = false) => {
    const ref = callRef.current;
    if (!ref) return;
    callRef.current = null;
    const body = JSON.stringify({ callRef: ref });
    if (beacon && navigator.sendBeacon?.('/api/call/end', body)) return;
    fetch('/api/call/end', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  }, []);

  const teardown = useCallback(() => {
    for (const t of timers.current) clearInterval(t);
    timers.current = [];
    try {
      mic.current?.close();
    } catch {}
    mic.current = null;
    remotes.current.clear();
    loudAt.current.clear();
    turn.current = null;
    barge.current = BARGE_START;
    if (floorTimer.current) clearTimeout(floorTimer.current);
    floorTimer.current = null;
    const c = client.current;
    client.current = null;
    c?.leave().catch(() => {});
  }, []);

  const hangUp = useCallback(() => {
    teardown();
    notifyEnd();
    setPhase((p) => (p === 'idle' ? p : 'ended'));
  }, [teardown, notifyEnd]);

  // Closing the tab or navigating away ends the call too.
  useEffect(() => {
    const onHide = () => {
      if (!callRef.current) return;
      teardown();
      notifyEnd(true);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      teardown();
      notifyEnd();
    };
  }, [teardown, notifyEnd]);

  useEffect(() => {
    capsEl.current?.scrollTo({ top: capsEl.current.scrollHeight, behavior: 'smooth' });
  }, [captions]);

  const pollCaptions = useCallback(async () => {
    const ref = callRef.current;
    if (!ref) return;
    const at = order.current.length ? `&step=${step.current}` : '';
    const r = await fetch(`/api/call/captions?ref=${encodeURIComponent(ref)}${at}`, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return;
    const j = (await r.json().catch(() => null)) as { captions?: Caption[]; ended?: boolean; room?: RoomView } | null;
    if (j?.captions?.length) setCaptions(j.captions);
    if (j?.room) setRoom(j.room);
    if (j?.ended) hangUp();
  }, [hangUp]);

  /** You talked over an agent: everyone stops and you have the floor. Fire and forget. */
  const hush = useCallback((uids: number[]) => {
    const ref = callRef.current;
    if (!ref) return;
    setFloorNote(true);
    if (floorTimer.current) clearTimeout(floorTimer.current);
    floorTimer.current = setTimeout(() => setFloorNote(false), FLOOR_NOTE_MS);
    fetch('/api/call/hush', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callRef: ref, uids }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { room?: RoomView } | null) => j?.room && setRoom(j.room))
      .catch(() => {});
  }, []);

  /** Standup: the previous voice is done, so the next one speaks. Past the last line, the normal conversation goes on. */
  const advance = useCallback(async () => {
    const ref = callRef.current;
    if (!ref || advancing.current) return;
    const next = step.current + 1;
    if (next >= order.current.length) {
      turn.current = null;
      return;
    }
    advancing.current = true;
    step.current = next;
    const last = next === order.current.length - 1;
    // The closing question needs no waiting: the user answers it.
    turn.current = last ? null : { step: next, uid: order.current[next], since: Date.now(), spoke: false };
    try {
      const r = await fetch('/api/call/standup/next', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callRef: ref, step: next }) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      // That voice could not speak: skip it at once instead of waiting it out.
      if ((!r.ok || !j?.ok) && turn.current?.step === next) turn.current = { ...turn.current, since: 0 };
      // The wait for its first words starts once the server has asked it to speak.
      else if (turn.current?.step === next && !turn.current.spoke) turn.current.since = Date.now();
    } catch {
      if (turn.current?.step === next) turn.current = { ...turn.current, since: 0 };
    } finally {
      advancing.current = false;
    }
  }, []);

  /**
   * Every 150 ms: speaking rings from each voice's real level and your mic level. The mic stays open (AEC/ANS/AGC)
   * so you can talk over anyone: your voice held above the barge-in level while an agent talks hushes them all.
   * Only the standup's scripted part keeps the mic off. In a standup this also takes turns: a voice that spoke and
   * then stayed quiet for HOLD_MS hands over.
   */
  const meter = useCallback(() => {
    const now = Date.now();
    const byUid: Record<number, number> = {};
    const talking: Record<number, boolean> = {};
    let anyTalking = false;
    for (const [uid, track] of remotes.current) {
      const lv = track.getVolumeLevel() ?? 0;
      byUid[uid] = lv;
      if (lv > SPEAKING_LEVEL) loudAt.current.set(uid, now);
      talking[uid] = now - (loudAt.current.get(uid) ?? 0) < HOLD_MS;
      anyTalking ||= talking[uid];
    }

    const t = turn.current;
    if (t && !advancing.current) {
      if (!t.spoke && (loudAt.current.get(t.uid) ?? 0) > t.since) { t.spoke = true; t.startedAt = now; }
      const lastLoud = loudAt.current.get(t.uid) ?? 0;
      const quiet = t.spoke && now - lastLoud > TURN_QUIET_MS && now - (t.startedAt ?? now) > MIN_TURN_MS;
      const neverStarted = !t.spoke && now - t.since > (t.step < 0 ? GREETING_WAIT_MS : START_WAIT_MS);
      if (quiet || neverStarted || now - t.since > MAX_TURN_MS) void advance();
    }
    const scripted = turn.current !== null || advancing.current;

    const m = mic.current;
    if (m) {
      const want = mutedRef.current || scripted;
      if (m.muted !== want) m.setMuted(want).catch(() => {});
    }
    const me = m && !m.muted ? m.getVolumeLevel() : 0;
    const b = bargeStep(barge.current, { level: me, agentSpeaking: anyTalking, muted: !m || m.muted, now }, BARGE);
    barge.current = b.state;
    if (b.fire) hush(Object.keys(talking).map(Number).filter((uid) => talking[uid] && uid !== AGENT_UID));
    setLevels({ byUid, talking, me, anyTalking, scripted });
  }, [advance, hush]);

  async function start(chosen: Mode) {
    setMode(chosen);
    setError(null);
    setCaptions([]);
    setParticipants([]);
    setReports([]);
    setSeconds(0);
    setRoom(null);
    setFloorNote(false);
    barge.current = BARGE_START;
    setMuted(false);
    mutedRef.current = false;
    order.current = [];
    step.current = -1;
    turn.current = null;
    setPhase('connecting');
    try {
      // The SDK loads only here, never in other bundles. Ask for the mic before the server starts an agent.
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      AgoraRTC.setLogLevel(3);
      AgoraRTC.disableLogUpload();
      try {
        mic.current = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true, encoderConfig: 'speech_standard' });
      } catch {
        throw new Error(`Allow the microphone to talk to ${hostName}.`);
      }

      let since: string | null = null;
      try {
        since = localStorage.getItem(LAST_STANDUP);
      } catch {}
      const res = await fetch('/api/call/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(agent ? { mode: 'call', agent: agent.slug } : chosen === 'standup' ? { mode: 'standup', since } : { mode: 'call' }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Started> & { error?: string };
      if (!res.ok || !data.callRef) throw new Error(data.error || `${hostName} couldn't pick up right now.`);
      callRef.current = data.callRef;
      setParticipants(data.participants ?? []);
      if (data.standup) {
        order.current = data.standup.order;
        setReports(data.standup.reports ?? []);
        try {
          localStorage.setItem(LAST_STANDUP, new Date().toISOString());
        } catch {}
      }

      const c = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      client.current = c;
      c.on('user-published', async (user, kind) => {
        if (kind !== 'audio') return;
        await c.subscribe(user, 'audio');
        user.audioTrack?.play();
        if (user.audioTrack) remotes.current.set(Number(user.uid), user.audioTrack);
      });
      c.on('user-unpublished', (user) => {
        remotes.current.delete(Number(user.uid));
      });
      // Slates hangs up after Goodbye (or when idle): end on our side too. A live agent's voice leaving changes nothing.
      c.on('user-left', (user) => {
        remotes.current.delete(Number(user.uid));
        if (Number(user.uid) === AGENT_UID) void pollCaptions().finally(hangUp);
      });
      await c.join(data.appId!, data.channel!, data.rtcToken!, data.uid!);
      await c.publish([mic.current]);

      const t0 = Date.now();
      // Standup: the host's greeting is step -1; the script starts when it goes quiet.
      if (order.current.length) turn.current = { step: -1, uid: AGENT_UID, since: t0, spoke: false };
      timers.current.push(
        setInterval(meter, 150),
        setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 1000),
        setInterval(() => void pollCaptions(), 1500),
      );
      setPhase('live');
    } catch (e) {
      teardown();
      notifyEnd();
      setError(e instanceof Error ? e.message : "Couldn't connect.");
      setPhase('idle');
    }
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    mic.current?.setMuted(next || levels.scripted).catch(() => {});
  }

  const hostLevel = levels.byUid[AGENT_UID] ?? 0;
  const ring = Math.min(1, hostLevel * 2.2);
  const hostTalking = !!levels.talking[AGENT_UID];
  const summary = summaryOf(captions);
  const standupLive = mode === 'standup' && phase === 'live';
  // Tiles whenever there is more than Slates to show: a standup, or live agents on a call.
  const tiles = phase === 'live' && (standupLive || participants.some((p) => p.live));
  const hasLive = participants.some((p) => p.live);
  const status = floorNote
    ? 'You have the floor'
    : levels.anyTalking
      ? 'Speaking'
      : levels.scripted
        ? 'Slates is giving the updates'
        : muted
          ? 'You are muted'
          : Object.values(room?.status ?? {}).includes('thinking')
            ? 'Thinking…'
            : 'Listening';
  /** A live agent's line: what it is doing now (its real voice level decides "Speaking"). */
  const liveLine = (p: Participant) => {
    if (levels.talking[p.uid]) return 'Speaking';
    if (room?.status[p.name] === 'thinking') return 'Thinking…';
    return p.line;
  };

  return (
    <div className="flex flex-col items-center" data-agent={agent?.color}>
      <div className="card flex w-full max-w-md flex-col items-center px-5 pb-6 pt-8">
        {tiles ? (
          <>
            <p className="text-[19px] font-medium tracking-[-0.03em]">{standupLive ? 'Standup' : hostName}</p>
            <p className="mt-0.5 h-5 text-sm text-fg-3 tabular" aria-live="polite">
              {clock(seconds)} · {status}
            </p>
            <ul className="mt-5 grid w-full grid-cols-2 gap-2.5" aria-label="On the call">
              <Tile
                name="You"
                line={muted ? 'Muted' : levels.scripted ? 'Your turn after the updates' : floorNote ? 'You have the floor' : 'Talk anytime'}
                level={levels.me}
                talking={levels.me > SPEAKING_LEVEL}
                you
              />
              {participants.map((p) => (
                <Tile key={p.uid} name={p.name} line={p.live ? liveLine(p) : p.line} level={levels.byUid[p.uid] ?? 0} talking={!!levels.talking[p.uid]} host={p.uid === AGENT_UID} live={p.live} agent={p.uid === AGENT_UID ? agent : undefined} />
              ))}
            </ul>
            {standupLive && reports.length > 0 && (
              <div className="mt-4 w-full rounded-2xl bg-surface px-4 py-3">
                <p className="kicker mb-1.5">Slates is covering</p>
                <ul className="space-y-1 text-sm leading-snug text-fg-2">
                  {reports.map((r) => (
                    <li key={r.name} className="truncate">
                      <span className="font-medium text-fg">{r.name}</span> · {r.line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Slates: the ring grows with its voice. */}
            <div className="relative grid size-40 place-items-center">
              <span
                aria-hidden
                className={`absolute inset-0 rounded-full transition-transform duration-150 ease-out ${agent ? 'bg-[var(--agent)]' : 'bg-accent'}`}
                style={{ transform: `scale(${phase === 'live' ? 0.72 + ring * 0.28 : 0.72})`, opacity: phase === 'live' && hostTalking ? 0.9 : 0.35 }}
              />
              <span className={`relative grid size-24 place-items-center rounded-full bg-surface shadow-[var(--shadow-float)] ${phase === 'connecting' ? 'animate-pulse' : ''}`}>
                {mode === 'standup' && phase !== 'idle' ? <Users className="size-11" strokeWidth={1.5} /> : agent ? <AgentMark icon={agent.icon} size="lg" /> : <Logo className="size-12" />}
              </span>
            </div>
            <p className="mt-3 text-[19px] font-medium tracking-[-0.03em]">{mode === 'standup' && phase !== 'idle' ? 'Standup' : hostName}</p>
            <p className="mt-0.5 h-5 text-sm text-fg-3" aria-live="polite">
              {phase === 'idle' && (agent ? 'Your agent, by voice' : 'Your assistant and your AI team, by voice')}
              {phase === 'connecting' && (mode === 'standup' ? 'Gathering your team…' : 'Connecting…')}
              {phase === 'live' && (
                <span className="tabular">
                  {clock(seconds)} · {status}
                </span>
              )}
              {phase === 'ended' && `Call ended · ${clock(seconds)}`}
            </p>
          </>
        )}

        {phase === 'live' && (
          <>
            {!tiles && (
              <div className="mt-5 flex w-full items-center gap-2.5 px-1" aria-label="Your microphone level">
                {muted ? <MicOff className="size-4 flex-none text-fg-3" strokeWidth={1.75} /> : <Mic className="size-4 flex-none text-fg-3" strokeWidth={1.75} />}
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-fg-2 transition-[width] duration-150" style={{ width: `${Math.min(100, levels.me * 220)}%` }} />
                </span>
              </div>
            )}
            <div ref={capsEl} className="no-scrollbar mt-4 max-h-56 w-full space-y-2 overflow-y-auto text-[15px] leading-snug" aria-live="polite">
              {captions.length === 0 ? (
                <p className="text-center text-sm text-fg-4">Captions appear here.</p>
              ) : (
                captions.slice(-8).map((c, i, a) => (
                  <p key={`${a.length - i}-${c.text.slice(0, 12)}`} className={i < a.length - 2 ? 'text-fg-3' : 'text-fg'}>
                    <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-fg-3">{agent && c.who === 'Slates' ? agent.name : c.who}</span>
                    {c.text}
                  </p>
                ))
              )}
            </div>
            {hasLive && <p className="mt-3 text-center text-xs text-fg-4">Headphones recommended: then you can talk over anyone.</p>}
            <div className="mt-6 flex items-center gap-4">
              <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} className={`btn btn-icon size-14 ${muted ? 'btn-primary' : 'btn-glass'}`}>
                {muted ? <MicOff className="size-5" strokeWidth={1.75} /> : <Mic className="size-5" strokeWidth={1.75} />}
              </button>
              <button type="button" onClick={hangUp} aria-label="End call" className="btn btn-icon size-14 bg-[#d64545] text-white">
                <PhoneOff className="size-5" strokeWidth={1.75} />
              </button>
            </div>
          </>
        )}

        {(phase === 'idle' || phase === 'connecting') && (
          <>
            <div className="mt-6 flex items-start justify-center gap-8">
              <StartButton label={`Call ${hostName}`} busyLabel="Calling…" icon={Phone} primary={mode === 'call'} busy={phase === 'connecting' && mode === 'call'} disabled={phase === 'connecting' || !ready} onClick={() => start('call')} />
              {!agent && <StartButton label="Standup" busyLabel="Joining…" icon={Users} primary={mode === 'standup'} busy={phase === 'connecting' && mode === 'standup'} disabled={phase === 'connecting' || !ready} onClick={() => start('standup')} />}
            </div>
            <p className="mt-4 max-w-xs text-center text-sm text-fg-3">
              {agent
                ? `${agent.name} reads and updates its own boards, notes and reminders while you talk, and hands anything else to your other agents.`
                : mode === 'standup'
                ? 'Slates tells you what each agent did since your last standup. Your live agents join so you can ask them; orders for the others are left for their next run.'
                : 'Talk it through: Slates reads and updates your boards, notes and reminders while you speak, asks your live agents, and hands bigger jobs to the rest.'}
            </p>
          </>
        )}

        {phase === 'ended' && (
          <div className="mt-5 w-full">
            {summary.length > 0 ? (
              <>
                <p className="kicker mb-2">{hostName} did</p>
                <ul className="space-y-1.5 text-[15px] leading-snug text-fg-2">
                  {summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-center text-sm text-fg-3">No changes mentioned on this call.</p>
            )}
            <div className="mt-6 flex justify-center gap-2.5">
              <button type="button" onClick={() => start('call')} className={`btn ${mode === 'call' ? 'btn-primary' : 'btn-glass'}`}>
                <Phone className="size-4" strokeWidth={1.75} /> Call again
              </button>
              {!agent && (
                <button type="button" onClick={() => start('standup')} className={`btn ${mode === 'standup' ? 'btn-primary' : 'btn-glass'}`}>
                  <Users className="size-4" strokeWidth={1.75} /> Standup
                </button>
              )}
            </div>
          </div>
        )}

        {agent && <p className="mt-5 text-center text-[12px] text-fg-4">Voice by Murf · Calls by Agora</p>}

        {error && (
          <p role="alert" className="note mt-5 w-full justify-center text-center">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function StartButton({
  label,
  busyLabel,
  icon: Icon,
  primary,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busyLabel: string;
  icon: typeof Phone;
  primary: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`btn rounded-full p-0 shadow-[var(--shadow-float)] ${primary ? 'btn-accent size-20' : 'btn-glass size-16 mt-2'} ${busy ? 'animate-pulse' : ''}`}
      >
        <Icon className={primary ? 'size-7' : 'size-6'} strokeWidth={1.75} />
      </button>
      <p className="mt-3 text-sm font-medium">{busy ? busyLabel : label}</p>
    </div>
  );
}

/** One voice on the call: initial in a circle, a ring that follows their real voice level, a dot for a live agent, and a line. */
function Tile({ name, line, level, talking, host, you, live, agent }: { name: string; line: string; level: number; talking: boolean; host?: boolean; you?: boolean; live?: boolean; agent?: CallAgent }) {
  const ring = talking ? 3 + Math.min(1, level * 2.2) * 5 : 0;
  return (
    <li className={`flex min-w-0 flex-col items-center rounded-2xl px-2.5 pb-3 pt-4 text-center transition-colors duration-150 ${talking ? 'bg-muted' : 'bg-surface'}`}>
      <span
        aria-hidden
        className={`grid size-14 place-items-center rounded-full text-[22px] font-medium transition-[box-shadow] duration-150 ${host ? 'bg-accent text-on-accent' : 'bg-muted text-fg'}`}
        style={{ boxShadow: ring ? `0 0 0 3px var(--surface), 0 0 0 ${3 + ring}px var(--accent)` : undefined }}
      >
        {agent ? <AgentMark icon={agent.icon} size="md" /> : host ? <Logo className="size-7" /> : (name.trim()[0] ?? '?').toUpperCase()}
      </span>
      <span className="mt-2 flex w-full items-center justify-center gap-1.5 text-[15px] font-medium">
        {live && <span aria-hidden className="size-1.5 flex-none rounded-full bg-[#2fb36b]" />}
        <span className="truncate">{name}</span>
        <span className="sr-only">{live ? ', live' : ''}{talking ? ', speaking' : ''}</span>
      </span>
      <span className={`mt-0.5 line-clamp-2 w-full text-xs leading-snug ${you ? 'text-fg-4' : 'text-fg-3'}`}>{line}</span>
    </li>
  );
}
