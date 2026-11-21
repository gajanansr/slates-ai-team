/**
 * Barge-in on a call (client and server safe, no imports): the mic stays open, and when your level stays above
 * a threshold for a moment while an agent is talking, the page asks the server to hush everyone (/api/call/hush).
 * Echo of the agents' own voices is mostly removed by the mic's AEC; headphones make it reliable.
 */

export type BargeConfig = { level: number; holdMs: number; cooldownMs: number };
export type BargeState = { loudSince: number | null; firedAt: number };
export type BargeInput = { level: number; agentSpeaking: boolean; muted: boolean; now: number };

export const BARGE_DEFAULTS: BargeConfig = { level: 0.08, holdMs: 250, cooldownMs: 1500 };
export const BARGE_START: BargeState = { loudSince: null, firedAt: -Infinity };

const inRange = (raw: unknown, lo: number, hi: number, d: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

/** NEXT_PUBLIC_CALL_BARGE_LEVEL (0.01–0.9) and NEXT_PUBLIC_CALL_BARGE_MS (50–3000), else the defaults. */
export function bargeConfig(level?: string, holdMs?: string): BargeConfig {
  return {
    level: inRange(level, 0.01, 0.9, BARGE_DEFAULTS.level),
    holdMs: inRange(holdMs, 50, 3000, BARGE_DEFAULTS.holdMs),
    cooldownMs: BARGE_DEFAULTS.cooldownMs,
  };
}

/**
 * One meter tick. `fire` once your voice has been above `level` for `holdMs` while an agent speaks; then not again
 * for `cooldownMs`. Muted, quiet, or nobody else talking resets the run.
 */
export function bargeStep(s: BargeState, x: BargeInput, cfg: BargeConfig = BARGE_DEFAULTS): { state: BargeState; fire: boolean } {
  if (x.muted || !x.agentSpeaking || !(x.level >= cfg.level)) return { state: { loudSince: null, firedAt: s.firedAt }, fire: false };
  const loudSince = s.loudSince ?? x.now;
  if (x.now - loudSince >= cfg.holdMs && x.now - s.firedAt >= cfg.cooldownMs) return { state: { loudSince: null, firedAt: x.now }, fire: true };
  return { state: { loudSince, firedAt: s.firedAt }, fire: false };
}
