import { supabaseServer } from '@/lib/supabase/server';
import { SlatesError } from '@/lib/slates';
import { buildAgent } from '@/lib/studio/service';
import type { BuildEvent } from '@/lib/studio/build';
import { agentIntro } from '@/lib/studio/intro';
import { profileOf } from '@/lib/profile';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Agent Studio: build an agent for the signed-in user. Streams newline-delimited JSON events
 * (stage, blueprint, one per piece as it is created, done, then its spoken intro, or error) so
 * the page can show the agent coming together.
 */
export async function POST(req: Request) {
  const client = await supabaseServer();
  const { data } = await client.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });

  let goal: string;
  let details: string | undefined;
  try {
    const body = await req.json();
    goal = typeof body?.goal === 'string' ? body.goal.trim().slice(0, 300) : '';
    details = typeof body?.details === 'string' ? body.details.trim().slice(0, 1500) || undefined : undefined;
    if (goal.length < 3) throw new Error();
  } catch {
    return Response.json({ error: 'Send {goal: "what the agent should do"}' }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: BuildEvent) => {
        try {
          ctrl.enqueue(enc.encode(JSON.stringify(e) + '\n'));
        } catch {
          /* the page went away; keep building so a retry finds the pieces */
        }
      };
      try {
        const built = await buildAgent({ client, token: null }, { goal, details }, send);
        // The agent introduces itself in its own Murf voice. Best effort: the agent is built either way.
        try {
          const intro = await agentIntro({ sb: client, userId: data.user!.id }, built.manifest, profileOf(data.user).name, { generate: true });
          if (intro.url) send({ type: 'intro', url: intro.url, text: intro.text, voice: intro.voice, label: intro.label });
        } catch (e) {
          console.warn('[studio] intro', (e as Error)?.message);
        }
      } catch (e) {
        console.error('[studio]', (e as Error)?.message);
        send({ type: 'error', message: e instanceof SlatesError ? e.message : 'Something went wrong while building. Try again: the parts already made are kept.' });
      } finally {
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
