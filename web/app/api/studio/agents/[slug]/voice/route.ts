import { supabaseServer } from '@/lib/supabase/server';
import { profileOf } from '@/lib/profile';
import { reminders } from '@/lib/reminders';
import { SlatesError, toSlatesError } from '@/lib/slates';
import { getAgent, setAgentVoice } from '@/lib/studio/build';
import { agentIntro } from '@/lib/studio/intro';
import { isVoiceId, voiceLabel, voiceOf } from '@/lib/voices';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * An agent's voice: POST {} returns its spoken intro (made with Murf and stored the first time);
 * POST {voice: "<Murf voice id>"} changes the voice first. Session-cookie auth, same-origin only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'forbidden' }, { status: 403 });
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const body = (await req.json().catch(() => ({}))) as { voice?: unknown } | null;
  if (body?.voice !== undefined && !isVoiceId(body.voice)) return Response.json({ error: 'Pick one of the listed voices.' }, { status: 422 });

  const caller = { client: sb, token: null };
  try {
    let m = await getAgent(caller, slug);
    if (!m) throw new SlatesError(`No agent "${slug}".`, 404, 'not_found');
    if (typeof body?.voice === 'string') m = await setAgentVoice(caller, m.slug, body.voice);
    const tz = m.voice ? undefined : (await reminders.context(caller).catch(() => null))?.timezone;
    const voice = voiceOf(m.voice, tz);
    try {
      const intro = await agentIntro({ sb, userId: data.user.id }, m, profileOf(data.user).name, { generate: true, timezone: tz });
      return Response.json({ voice: voice.id, label: voiceLabel(voice), intro }, { headers: { 'cache-control': 'no-store' } });
    } catch (e) {
      // The voice is saved either way; only the clip is missing.
      return Response.json({ voice: voice.id, label: voiceLabel(voice), intro: null, error: toSlatesError(e).message }, { headers: { 'cache-control': 'no-store' } });
    }
  } catch (e) {
    const err = toSlatesError(e);
    return Response.json({ error: err.message }, { status: err.status });
  }
}
