'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

const MAX_SECONDS = 10 * 60;
/** Speech sounds fine at 24 kbps mono: about 0.2 MB a minute. */
const BITRATE = 24_000;

function pickType() {
  if (typeof MediaRecorder === 'undefined') return null;
  // Opus in WebM is the smallest; iPhones record AAC in MP4 instead.
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

/** Record a voice note: tap to start, tap to stop. The clip is handed over already compressed. */
export function VoiceButton({ disabled, onClip, onError }: { disabled?: boolean; onClip: (clip: File) => void | Promise<void>; onError: (message: string) => void }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const recording = seconds !== null;

  const stop = () => rec.current?.state === 'recording' && rec.current.stop();
  useEffect(() => () => {
    if (tick.current) clearInterval(tick.current);
    if (rec.current?.state === 'recording') {
      rec.current.ondataavailable = null;
      rec.current.onstop = null;
      rec.current.stop();
    }
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    const type = pickType();
    if (!type || !navigator.mediaDevices?.getUserMedia) return onError('This browser cannot record voice notes.');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      return onError('Allow the microphone to record a voice note.');
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: BITRATE });
    r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    r.onstop = () => {
      if (tick.current) clearInterval(tick.current);
      stream.getTracks().forEach((t) => t.stop());
      setSeconds(null);
      const mime = type.split(';')[0];
      const blob = new Blob(chunks, { type: mime });
      if (blob.size < 800) return onError('That was too short to keep.');
      void onClip(new File([blob], `voice-${Date.now()}.${mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm'}`, { type: mime }));
    };
    rec.current = r;
    r.start(1000);
    setSeconds(0);
    navigator.vibrate?.(10);
    tick.current = setInterval(() => setSeconds((s) => {
      const next = (s ?? 0) + 1;
      if (next >= MAX_SECONDS) stop();
      return next;
    }), 1000);
  };

  const label = seconds !== null ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : null;
  return (
    <button
      type="button"
      disabled={disabled && !recording}
      onClick={recording ? stop : start}
      aria-label={recording ? 'Stop recording' : 'Record a voice note'}
      aria-pressed={recording}
      className={`flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl text-[13px] tabular-nums ${recording ? 'animate-pulse bg-accent px-2.5 text-on-accent' : 'flex-1 text-fg-2 active:bg-muted'}`}
    >
      {recording ? <Square className="size-3.5" fill="currentColor" /> : <Mic className="size-[18px]" strokeWidth={1.9} />}
      {label}
    </button>
  );
}
