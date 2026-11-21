import { supabaseServer } from '@/lib/supabase/server';
import { assistantErrorMessage, assistantReady, runAssistant, type AskEvent, type ChatTurn } from '@/lib/assistant';
import { direct, route, snapshot, TOOLS_FOR } from '@/lib/ask-router';
import { slates, SlatesError } from '@/lib/slates';
import { reminders } from '@/lib/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Text-model questions per user per day. Simple actions (add, tick, remind, move, file, search) are free. */
const DAILY_LIMIT = Number(process.env.ASK_DAILY_LIMIT || 20);

/**
 * Ask Slates: streams newline-delimited JSON events (text deltas, tool activity, done).
 * 1. Jev routes the request. 2. Simple actions run directly, with no text model.
 * 3. Anything else goes to the free text model with a board snapshot and only the tools it needs.
 */
export async function POST(req: Request) {
  const client = await supabaseServer();
  const { data } = await client.auth.getUser();
  if (!data.user) return Response.json({ error: 'Sign in first' }, { status: 401 });

  let turns: ChatTurn[];
  try {
    const body = await req.json();
    turns = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
      .slice(-20);
    if (!turns.length || turns[turns.length - 1].role !== 'user') throw new Error();
  } catch {
    return Response.json({ error: 'Send {messages:[{role:"user",content}]}' }, { status: 400 });
  }

  const caller = { client, token: null };
  const q = turns[turns.length - 1].content.slice(0, 2000);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: AskEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + '\n'));
      try {
        const [all, ctx] = await Promise.all([slates.list(caller), reminders.context(caller).catch(() => ({ now: new Date().toISOString(), timezone: 'Asia/Kolkata' }))]);
        const r = await route(q, all);

        // "Manage my dairy business" / "build me an agent that…": Agent Studio builds it. It has its own
        // daily limit, so it doesn't use an Ask question.
        if (r.intent === 'build_agent' && r.confidence >= (r.by === 'rules' ? 0.8 : 0.7) && assistantReady()) {
          send({ type: 'tool', name: 'build_agent', title: 'Building your agent' });
          const { buildAgent } = await import('@/lib/studio/service');
          let built: Awaited<ReturnType<typeof buildAgent>>;
          try {
            built = await buildAgent(caller, { goal: q }, undefined, req.signal);
          } catch (e) {
            if (!(e instanceof SlatesError)) throw e;
            send({ type: 'error', message: e.message });
            return;
          }
          const m = built.manifest;
          const reply = [
            `**${m.name}** is ready: ${m.mission}`,
            '',
            ...m.boards.map((b) => `- [${b.title}](/s/${b.slug})`),
            '',
            `[Open ${m.name}](${built.path})${m.questions.length ? `\n\nTo make it yours: ${m.questions[0]}` : ''}`,
          ].join('\n');
          send({ type: 'text', text: reply });
          send({ type: 'meta', mode: 'direct', changed: true });
          send({ type: 'done', text: reply });
          return;
        }

        // Follow-ups in a conversation ("yes", "the second one") need context: skip direct actions.
        const fresh = turns.length === 1 || r.intent === 'remind' || r.intent === 'add_item';
        const d = fresh ? await direct(caller, q, r, all, ctx.timezone).catch((e) => (console.warn('[ask] direct', e?.message), null)) : null;
        if (d) {
          for (const t of d.tools) send({ type: 'tool', name: t, title: t });
          send({ type: 'text', text: d.reply });
          send({ type: 'meta', mode: 'direct', changed: d.changed });
          send({ type: 'done', text: d.reply });
          return;
        }

        if (!assistantReady()) {
          send({ type: 'error', message: "I can do quick things (add, tick, remind, move, search, file the Inbox). Questions need an AI key on the server, which isn't set up yet." });
          return;
        }
        const take = await client.rpc('ask_take', { p_limit: DAILY_LIMIT });
        if (take.error?.code === 'P0429') {
          send({
            type: 'error',
            message: `You've used today's ${DAILY_LIMIT} AI questions. Quick actions still work: add, tick, remind, move, search and filing the Inbox.`,
          });
          return;
        }
        if (take.error) console.warn('[ask] usage', take.error.message);

        const intent = r.confidence >= 0.5 ? r.intent : 'other';
        const text = await runAssistant(caller, turns, send, {
          signal: req.signal,
          toolNames: TOOLS_FOR[intent],
          extraSystem: snapshot(all, r.slug, new Date(ctx.now).toLocaleString('en-IN', { timeZone: ctx.timezone, dateStyle: 'full', timeStyle: 'short' }), ctx.timezone),
          maxSteps: 6,
        });
        send({ type: 'meta', mode: 'ai', left: typeof take.data === 'number' ? take.data : undefined });
        send({ type: 'done', text });
      } catch (e) {
        if (!req.signal.aborted) {
          console.error('[ask]', e);
          send({ type: 'error', message: assistantErrorMessage(e) });
        }
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
