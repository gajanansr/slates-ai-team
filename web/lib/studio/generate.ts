import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, GROQ, MODEL, OPENROUTER, providers, type Compat } from '@/lib/assistant';
import { SlatesError } from '@/lib/slates';
import { blueprintPrompt, blueprintRequest, extractJson, repairBlueprint, type Blueprint } from '@/lib/studio/blueprint';

/**
 * Goal text -> blueprint, with the same providers and keys Ask Slates uses (Groq, OpenRouter,
 * Gemini, Anthropic; order from ASK_PROVIDERS, or STUDIO_PROVIDERS to prefer a stronger model
 * here). A provider whose reply can't be turned into a usable blueprint falls through to the next.
 */

const TIMEOUT = 70_000;

function chain() {
  const all = providers();
  const order = (process.env.STUDIO_PROVIDERS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!order.length) return all;
  const rank = (p: string) => {
    const i = order.findIndex((o) => p === o || p.startsWith(`${o}:`));
    return i < 0 ? order.length : i;
  };
  return [...all].sort((a, b) => rank(a) - rank(b));
}

async function compat(api: Compat, model: string, system: string, user: string, signal?: AbortSignal) {
  const call = (json: boolean) =>
    fetch(api.url, {
      method: 'POST',
      headers: { ...api.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_completion_tokens: 8000,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT),
    });
  let res = await call(true);
  // Some free models don't take response_format: ask again without it.
  if (res.status === 400) res = await call(false);
  if (!res.ok) throw Object.assign(new Error(`${api.label} ${model}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  return String((await res.json())?.choices?.[0]?.message?.content ?? '');
}

async function ask(p: string, system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (p.startsWith('groq:')) return compat(GROQ, p.slice(5), system, user, signal);
  if (p.startsWith('openrouter:')) return compat(OPENROUTER, p.slice(11), system, user, signal);
  if (p === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: TIMEOUT, retryOptions: { attempts: 1 } } });
    const r = await ai.models.generateContent({ model: GEMINI_MODEL(), contents: user, config: { systemInstruction: system, responseMimeType: 'application/json', abortSignal: signal } });
    return r.text ?? '';
  }
  const client = new Anthropic();
  const msg = await client.messages.create({ model: MODEL, max_tokens: 12000, system, messages: [{ role: 'user', content: user }] }, { signal, timeout: TIMEOUT });
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

export const studioReady = () => chain().length > 0;

export async function generateBlueprint(
  goal: string,
  details: string | undefined,
  ctx: { timezone: string; now?: Date; signal?: AbortSignal },
): Promise<{ blueprint: Blueprint; repairs: string[]; provider: string }> {
  const list = chain();
  if (!list.length) throw new SlatesError('Agent Studio needs an AI key on the server (the same one Ask Slates uses).', 503, 'unavailable');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timezone, dateStyle: 'full' }).format(ctx.now ?? new Date());
  const system = blueprintPrompt();
  const user = blueprintRequest(goal, details, { timezone: ctx.timezone, today });
  const fails: string[] = [];
  for (const p of list) {
    try {
      const reply = await ask(p, system, user, ctx.signal);
      const { blueprint, repairs } = repairBlueprint(extractJson(reply), goal, { timezone: ctx.timezone });
      if (repairs.length) console.warn('[studio] repaired blueprint from', p, repairs.slice(0, 8));
      return { blueprint, repairs, provider: p };
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      const msg = `${p}: ${String((e as Error)?.message ?? e).replace(/AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}|sk-or-[0-9A-Za-z_-]{10,}/g, '…').slice(0, 160)}`;
      fails.push(msg);
      console.warn('[studio] provider failed, trying next:', msg);
    }
  }
  throw new SlatesError(`Couldn't design the agent right now. Try again in a minute. (${fails.join(' | ').slice(0, 400)})`, 502, 'upstream');
}
