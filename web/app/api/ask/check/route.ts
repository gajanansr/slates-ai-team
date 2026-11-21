import { supabaseServer } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { jev, jevLastError, keyFacts, pick } from '@/lib/jev';
import { GEMINI_MODEL, openrouterKey, providers, runAssistant } from '@/lib/assistant';
import { snapshot, TOOLS_FOR } from '@/lib/ask-router';
import { slates } from '@/lib/slates';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** Admin-only health check: does each AI key work right now? Never returns keys. */
export async function GET(req: Request) {
  const client = await supabaseServer();
  const { data: admin } = await client.rpc('is_admin');
  if (admin !== true) return Response.json({ error: 'Admins only' }, { status: 403 });
  const t = async (fn: () => Promise<string>) => {
    const started = Date.now();
    try {
      return { ok: true, result: await fn(), ms: Date.now() - started };
    } catch (e: any) {
      return { ok: false, status: e?.status, error: String(e?.message ?? e).replace(/AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}|sk-or-[0-9A-Za-z_-]{10,}/g, '…').slice(0, 900), ms: Date.now() - started };
    }
  };
  // Where this server runs, and how long a database round trip takes from here.
  const rt: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await client.rpc('is_admin');
    rt.push(Date.now() - t0);
  }
  const t1 = Date.now();
  await client.auth.getUser();
  const out: Record<string, unknown> = {
    server_region: process.env.VERCEL_REGION ?? 'local',
    db_roundtrip_ms: rt,
    auth_check_ms: Date.now() - t1,
    order: providers(),
  };
  out.jev = process.env.TYPESAFE_API_KEY
    ? await t(async () => {
        const a = await jev({ request: 'add milk to my groceries list' }, { intent: { type: 'choice', instructions: 'What does the user want?', criteria: { add_item: 'Add an item to a list', question: 'Ask a question' } } });
        const p = pick(a, 'intent');
        if (!p) throw new Error(`Jev said: ${jevLastError() || 'no answer'}`);
        return `${p.choice} (${p.confidence.toFixed(2)})`;
      })
    : 'not configured';
  if (process.env.TYPESAFE_API_KEY) out.jev_key = keyFacts();
  out.gemini = process.env.GEMINI_API_KEY
    ? await t(async () => {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } } });
        const r = await ai.models.generateContent({ model: GEMINI_MODEL(), contents: 'Reply with the single word: ok' });
        return `${GEMINI_MODEL()}: ${(r.text ?? '').trim().slice(0, 40)}`;
      })
    : 'not configured';
  out.groq = process.env.GROQ_API_KEY
    ? await t(async () => {
        const model = (process.env.GROQ_MODELS || 'openai/gpt-oss-120b').split(',')[0].trim();
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_completion_tokens: 50 }),
        });
        if (!res.ok) throw Object.assign(new Error((await res.text()).slice(0, 300)), { status: res.status });
        return `${model}: ${String((await res.json())?.choices?.[0]?.message?.content ?? '').trim().slice(0, 40)}`;
      })
    : 'not configured';
  out.openrouter = openrouterKey()
    ? await t(async () => {
        const model = (process.env.OPENROUTER_MODELS || 'google/gemma-4-31b-it:free').split(',')[0].trim();
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openrouterKey()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 20 }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw Object.assign(new Error((await res.text()).slice(0, 300)), { status: res.status });
        return `${model}: ${String((await res.json())?.choices?.[0]?.message?.content ?? '').trim().slice(0, 40)}`;
      })
    : 'not configured';
  // A real Ask, the same request shape the app sends (tools + board snapshot). Read-only question.
  out.ask = await t(async () => {
    const caller = { client, token: null };
    const all = await slates.list(caller);
    const text = await runAssistant(caller, [{ role: 'user', content: 'How many boards do I have? Answer in one short sentence.' }], () => {}, {
      toolNames: TOOLS_FOR.question,
      extraSystem: snapshot(all, null, new Date().toString(), 'Asia/Kolkata'),
      maxSteps: 3,
    });
    return text.trim().slice(0, 120);
  });
  // Email: is Resend set up, and (with ?mail=send) does a real test email go out to you?
  const { mailFrom, mailReady, sendMail, layout } = await import('@/lib/mail');
  out.mail = { configured: mailReady(), from: mailFrom() };
  if (new URL(req.url).searchParams.get('mail') === 'send') {
    const { data: me } = await client.auth.getUser();
    const to = me.user?.email;
    out.mail_test = to
      ? { to, ...(await sendMail(to, { subject: 'Slates test email', html: layout({ title: 'Email works.', body: 'This is a test from your Slates admin check.' }), text: 'Email works. Test from your Slates admin check.' })) }
      : 'no email on your account';
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
