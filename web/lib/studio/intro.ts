import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET } from '@/lib/files';
import { SlatesError } from '@/lib/slates';
import { introKey, introText, voiceLabel, voiceOf } from '@/lib/voices';
import type { AgentManifest } from '@/lib/studio/build';

/**
 * An agent's spoken intro: a short first-person line in its own Murf voice (FALCON, the same
 * model its calls use), stored once in the user's private attachments folder and served by a
 * short-lived signed URL. The file name is a hash of (agent, voice, text), so a view never
 * regenerates it and a new voice or a new mission makes a new clip.
 */

export const MURF_STREAM = 'https://global.api.murf.ai/v1/speech/stream';
const SIGN_SECONDS = 3600;
const MAX_CLIP = 2 * 1024 * 1024;

export type IntroDeps = { sb: SupabaseClient; userId: string; env?: Record<string, string | undefined>; fetch?: typeof fetch };
export type Intro = { url: string | null; text: string; voice: string; label: string; cached: boolean };

/** The clip's storage path: the user's own folder (Storage RLS), keyed by slug + hash. */
export const introPath = (userId: string, slug: string, voice: string, text: string) => `${userId}/agent-voice/${slug}-${introKey(slug, voice, text)}.mp3`;

/** Text -> MP3 bytes with Murf's streaming endpoint (FALCON). */
export async function murfSpeak(text: string, voiceId: string, { key, fetch: f = fetch }: { key: string; fetch?: typeof fetch }): Promise<Uint8Array> {
  const voice = voiceOf(voiceId);
  const res = await f(MURF_STREAM, {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, voiceId: voice.id, locale: voice.locale, model: 'FALCON', format: 'MP3', sampleRate: 24000, channelType: 'MONO' }),
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    console.warn('[intro] murf failed', res.status, detail);
    throw new SlatesError(res.status === 402 ? 'The voice service is out of credit.' : "Couldn't make the voice right now. Try again in a moment.", 502, 'upstream');
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_CLIP) throw new SlatesError("Couldn't make the voice right now.", 502, 'upstream');
  return buf;
}

async function sign(sb: SupabaseClient, path: string) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGN_SECONDS);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/**
 * The intro for an agent. With `generate: false` it only looks up a stored clip (cheap, for page
 * loads); with `generate: true` it makes and stores one when missing.
 */
export async function agentIntro(deps: IntroDeps, m: Pick<AgentManifest, 'slug' | 'name' | 'mission' | 'voice'>, firstName: string | null, opts: { generate?: boolean; timezone?: string } = {}): Promise<Intro> {
  const voice = voiceOf(m.voice, opts.timezone);
  const text = introText(m, firstName);
  const base = { text, voice: voice.id, label: voiceLabel(voice) };
  const path = introPath(deps.userId, m.slug, voice.id, text);
  const have = await sign(deps.sb, path);
  if (have) return { ...base, url: have, cached: true };
  if (!opts.generate) return { ...base, url: null, cached: false };

  const key = (deps.env ?? process.env).MURF_API_KEY?.trim();
  if (!key) throw new SlatesError("Voices aren't set up yet.", 503, 'unavailable');
  const mp3 = await murfSpeak(text, voice.id, { key, fetch: deps.fetch });
  const { error } = await deps.sb.storage.from(BUCKET).upload(path, mp3, { contentType: 'audio/mpeg', upsert: false, cacheControl: '31536000' });
  // Another tab made the same clip first: that one is just as good.
  if (error && !/exists|duplicate/i.test(error.message)) {
    console.warn('[intro] upload failed', error.message);
    throw new SlatesError("Couldn't save the voice clip.", 500, 'internal');
  }
  const url = await sign(deps.sb, path);
  if (!url) throw new SlatesError("Couldn't save the voice clip.", 500, 'internal');
  return { ...base, url, cached: false };
}
