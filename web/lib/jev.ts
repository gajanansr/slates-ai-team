import 'server-only';

/**
 * TypeSafe AI's Jev ("System One" model): answers multiple-choice questions about a piece
 * of text with a calibrated confidence, in well under a second. Slates uses it to route Ask
 * requests and file the Inbox, so most requests never need a text model.
 * Wire format matches @typesafe-ai/sdk 0.7: POST {base}/v1/systemone with a bearer key.
 */
/** The key as stored, minus common paste mistakes: quotes, spaces, "Bearer ", "TYPESAFE_API_KEY=". */
const key = () =>
  (process.env.TYPESAFE_API_KEY ?? '')
    .trim()
    .replace(/^TYPESAFE_API_KEY\s*=\s*/i, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();

/** Safe facts about the stored key for the admin check (never the key itself). */
export function keyFacts() {
  const raw = process.env.TYPESAFE_API_KEY ?? '';
  const k = key();
  return {
    length: k.length,
    starts: k.slice(0, 3),
    raw_had_extras: raw !== k,
    has_inner_space: /\s/.test(k),
    endpoint: base(),
  };
}

/**
 * Where to send the key. An OpenRouter key (sk-or-…) only works on OpenRouter's copy of the
 * System One API (same wire format, billed to OpenRouter); TypeSafe keys go to TypeSafe.
 */
const base = () => process.env.TYPESAFE_BASE_URL || (key().startsWith('sk-or-') ? 'https://openrouter.ai/api' : 'https://api.typesafe.ai');

let lastError = '';
/** The last error Jev returned (for the admin check). */
export const jevLastError = () => lastError;
export const jevReady = () => Boolean(key());

export type ChoiceQ = { type: 'choice'; instructions: string; criteria: Record<string, string | null> };
export type NoulQ = { type: 'noul'; instructions: string; criteria?: { yes?: string; no?: string } };
export type Choice = { choice: string; confidence: number };

type Answers = Record<string, { type: string; choice?: string; confidence?: number; noul?: number }>;

/** Ask Jev; returns null on any failure so callers can fall back. */
export async function jev(state: unknown, questions: Record<string, ChoiceQ | NoulQ>, timeoutMs = 6000): Promise<Answers | null> {
  if (!jevReady()) return null;
  for (const q of Object.values(questions)) {
    if (q.type === 'choice' && (Object.keys(q.criteria).length < 1 || Object.keys(q.criteria).length > 255)) return null;
  }
  try {
    const res = await fetch(`${base()}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ state, questions, model: process.env.TYPESAFE_MODEL || 'jev-latest' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
      console.warn('[jev]', lastError);
      return null;
    }
    const body = (await res.json()) as { answers?: Answers };
    return body.answers ?? null;
  } catch (e) {
    lastError = (e as Error).message;
    console.warn('[jev]', lastError);
    return null;
  }
}

export const pick = (a: Answers | null, name: string): Choice | null => {
  const x = a?.[name];
  return x?.choice ? { choice: x.choice, confidence: Number(x.confidence ?? 0) } : null;
};
