/**
 * Agent voices: a curated set of Murf voices an Agent Studio agent can speak with, on its intro
 * and on calls (Agora's Murf TTS, model FALCON). Every id here was checked against
 * GET https://api.murf.ai/v1/speech/voices?model=falcon-2.1 (Nov 21, 2026); voices that only exist
 * for GEN2 (en-IN-rohan, en-US-iris, en-US-charles) are left out because calls use FALCON.
 * Pure: safe in the browser, the server and tests.
 */

export type AgentVoice = {
  id: string;
  name: string;
  /** Murf locale: the id's prefix. */
  locale: string;
  /** How the accent reads to a person: "Indian English". */
  accent: string;
  gender: 'female' | 'male';
  /** A few words for the model choosing one. */
  tone: string;
};

const ACCENTS: Record<string, string> = { 'en-IN': 'Indian English', 'en-US': 'American English', 'en-UK': 'British English' };

const v = (id: string, gender: AgentVoice['gender'], tone: string): AgentVoice => {
  const locale = id.split('-').slice(0, 2).join('-');
  const name = id.split('-')[2];
  return { id, name: name[0].toUpperCase() + name.slice(1), locale, accent: ACCENTS[locale] ?? locale, gender, tone };
};

export const VOICES: readonly AgentVoice[] = [
  v('en-IN-aarav', 'male', 'warm, steady, middle-aged; managers and businesses'),
  v('en-IN-eashwar', 'male', 'calm, mature; money, planning, operations'),
  v('en-IN-nikhil', 'male', 'friendly, conversational; everyday helpers'),
  v('en-IN-priya', 'female', 'friendly, young; coaches, habits, wellbeing'),
  v('en-IN-isha', 'female', 'bright, upbeat; launches, deals, social'),
  v('en-IN-alia', 'female', 'composed, mature; health, family, finance'),
  v('en-IN-anusha', 'female', 'clear, conversational; study and work'),
  v('en-US-natalie', 'female', 'clear, friendly; general assistant'),
  v('en-US-amara', 'female', 'warm, young; coaching and wellbeing'),
  v('en-US-caleb', 'male', 'steady, mature; business and finance'),
  v('en-US-daniel', 'male', 'energetic, young; projects and launches'),
  v('en-US-miles', 'male', 'helpful, support-agent style; service and ops'),
  v('en-UK-hazel', 'female', 'crisp, young; research and writing'),
  v('en-UK-mason', 'male', 'measured, mature; planning and advice'),
];

export const VOICE_IDS = VOICES.map((x) => x.id) as [string, ...string[]];
const BY_ID = new Map(VOICES.map((x) => [x.id, x]));

export const DEFAULT_VOICE = 'en-US-natalie';
export const DEFAULT_INDIA_VOICE = 'en-IN-aarav';

export const isVoiceId = (x: unknown): x is string => typeof x === 'string' && BY_ID.has(x);

/** India's timezones get an Indian English voice by default; everyone else American English. */
export const inIndia = (tz: string | null | undefined) => /^Asia\/(Kolkata|Calcutta)$/.test(tz ?? '');
export const defaultVoiceFor = (tz?: string | null) => (inIndia(tz) ? DEFAULT_INDIA_VOICE : DEFAULT_VOICE);

/** A voice by id, else the regional default. Never undefined. */
export function voiceOf(id: unknown, tz?: string | null): AgentVoice {
  return (isVoiceId(id) && BY_ID.get(id)) || BY_ID.get(defaultVoiceFor(tz))!;
}

/** Model output -> a voice id: an exact id, or a bare name ("aarav", "Aarav (M)"), else the regional default. */
export function resolveVoice(raw: unknown, tz?: string | null): string {
  if (typeof raw === 'string') {
    if (BY_ID.has(raw)) return raw;
    const s = raw.trim().toLowerCase();
    if (BY_ID.has(s)) return s;
    const name = s.replace(/\(.*\)/, '').trim().split(/[\s-]+/).at(-1);
    const hits = VOICES.filter((x) => x.name.toLowerCase() === name);
    if (hits.length) return (hits.find((x) => (inIndia(tz) ? x.locale === 'en-IN' : x.locale !== 'en-IN')) ?? hits[0]).id;
  }
  return defaultVoiceFor(tz);
}

/** "Aarav, Indian English" */
export const voiceLabel = (x: AgentVoice) => `${x.name}, ${x.accent}`;

/** The picker: the current voice first, then others from the same accent, then the rest; `max` in all (3-6). */
export function voiceOptions(current: string, max = 6): AgentVoice[] {
  const cur = voiceOf(current);
  const same = VOICES.filter((x) => x.id !== cur.id && x.locale === cur.locale);
  // Alternate genders so a short list still offers both.
  const mixed = [...same.filter((x) => x.gender !== cur.gender), ...same.filter((x) => x.gender === cur.gender)];
  const ordered: AgentVoice[] = [cur];
  for (let i = 0; ordered.length < max && i < mixed.length; i++) ordered.push(mixed[i]);
  for (const x of VOICES) if (ordered.length < max && !ordered.includes(x)) ordered.push(x);
  return ordered.slice(0, Math.max(3, Math.min(6, max)));
}

/** Lines for the blueprint prompt. */
export const voicePromptList = () => VOICES.map((x) => `${x.id} (${x.gender}, ${x.accent}: ${x.tone})`).join('; ');

// ------------------------------------------------------------------ intro

export const INTRO_MAX_WORDS = 35;

const firstOf = (name: string | null | undefined) => name?.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, 30) || '';

/** "Keeps your milk ..." -> "keep your milk ...": third-person mission -> what "I'll" do. */
function firstPerson(mission: string) {
  const m = mission.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  const [verb, ...rest] = m.split(' ');
  const w = verb.toLowerCase();
  let base: string | null = null;
  if (/^[a-z]+(ches|shes|sses|xes|zes)$/.test(w)) base = w.slice(0, -2);
  else if (/^[a-z]+[^aeiou]ies$/.test(w)) base = `${w.slice(0, -3)}y`;
  else if (/^[a-z]{3,}s$/.test(w) && !/ss$/.test(w)) base = w.slice(0, -1);
  if (base) return `I'll ${[base, ...rest].join(' ')}`;
  return `My job: ${m.charAt(0).toLowerCase()}${m.slice(1)}`;
}

/** Cut to `max` words; ends with a full stop. */
function capWords(s: string, max: number) {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= max) return s.trim();
  return `${words.slice(0, max).join(' ').replace(/[,;:\-–]+$/, '')}.`;
}

/**
 * The agent's spoken intro, first person, at most 35 words:
 * "Hi Gajanan, I'm your Dairy Manager. I'll keep your milk collection ... Call me any time."
 */
export function introText(agent: { name: string; mission: string }, firstName?: string | null) {
  const first = firstOf(firstName);
  const hi = `Hi${first ? ` ${first}` : ''}, I'm your ${agent.name.trim()}.`;
  const close = ' Call me any time.';
  const budget = INTRO_MAX_WORDS - hi.split(/\s+/).length - close.trim().split(/\s+/).length;
  const body = capWords(`${firstPerson(agent.mission)}.`, Math.max(5, budget));
  return capWords(`${hi} ${body}${close}`, INTRO_MAX_WORDS);
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** FNV-1a, 2 x 32 bits: a short stable key, same in the browser and on the server. */
function fnv(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Cache key for an intro clip: the same (agent, voice, text) always maps to the same file. */
export function introKey(slug: string, voice: string, text: string) {
  const s = `${slug}\n${voice}\n${text}`;
  return `${fnv(s, 0x811c9dc5)}${fnv(s, 0x9e3779b9)}`;
}
