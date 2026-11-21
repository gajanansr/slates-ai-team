import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, type Part } from '@google/genai';
import { TOOLS, toolJsonSchema } from '@/lib/agent/tools';
import { toSlatesError, type Caller } from '@/lib/slates';
import { z } from 'zod';

/**
 * Ask Slates: Claude with the same tool set external agents get, acting as the signed-in
 * user (in the app) or as the user's built-in "Slates" agent (schedules, inbox filing).
 */
export const MODEL = 'claude-opus-5-5';
/** Free-tier friendly default; override with GEMINI_MODEL (e.g. gemini-3.8-flash). */
export const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
/** Free models on Groq, tried in order when Gemini is unavailable or out of quota. */
const GROQ_MODELS = () => (process.env.GROQ_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.8-27b').split(',').map((m) => m.trim()).filter(Boolean);
/** OpenRouter key: OPENROUTER_API_KEY, or the OpenRouter key (sk-or-…) already stored for Jev. */
export const openrouterKey = () => {
  const k = (process.env.OPENROUTER_API_KEY || '').trim();
  if (k) return k;
  const t = (process.env.TYPESAFE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '').replace(/^Bearer\s+/i, '');
  return t.startsWith('sk-or-') ? t : '';
};
/** Free OpenRouter models (with tool use), tried after Groq. */
const OPENROUTER_MODELS = () => (process.env.OPENROUTER_MODELS || 'google/gemma-4-31b-it:free').split(',').map((m) => m.trim()).filter(Boolean);
/** Providers in the order to try: free first, paid last. */
export function providers(): string[] {
  // Groq first: it answers in well under a second. Then free OpenRouter models; Gemini's free tier is often throttled.
  const all = [
    ...(process.env.GROQ_API_KEY ? GROQ_MODELS().map((m) => `groq:${m}`) : []),
    ...(openrouterKey() ? OPENROUTER_MODELS().map((m) => `openrouter:${m}`) : []),
    ...(process.env.GEMINI_API_KEY ? ['gemini'] : []),
    ...(process.env.ANTHROPIC_API_KEY ? ['anthropic'] : []),
  ];
  const order = (process.env.ASK_PROVIDERS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return order.length ? [...all].sort((a, b) => rank(order, a) - rank(order, b)) : all;
}
const rank = (order: string[], p: string) => {
  const i = order.findIndex((o) => p === o || p.startsWith(`${o}:`));
  return i < 0 ? order.length : i;
};
export const assistantReady = () => providers().length > 0;
/** Ask is usable when there is a text model, or at least Jev for quick actions. */
export const askReady = () => assistantReady() || Boolean(process.env.TYPESAFE_API_KEY);

/** Map provider errors to a short user-facing message. */
export function assistantErrorMessage(e: unknown) {
  const status = (e as { status?: number })?.status;
  const detail = String((e as Error)?.message ?? '')
    .replace(/key=[^&\s]+/gi, 'key=…')
    .replace(/AIza[0-9A-Za-z_-]{20,}|gsk_[0-9A-Za-z]{20,}|sk-or-[0-9A-Za-z_-]{10,}/g, '…')
    .slice(0, 700);
  if (status === 429) {
    const quota = detail.match(/Quota exceeded for metric:[^,]*|limit: ?\d+[^"]*|retry in [\d.]+s/gi)?.join(' · ');
    return `The AI quota is used up for now${quota ? ` (${quota.slice(0, 200)})` : detail ? ` (${detail})` : ''}. Try again in a minute.`;
  }
  if (e instanceof Anthropic.APIError || typeof status === 'number') return `The assistant is unavailable right now${detail ? ` (${detail})` : ''}.`;
  return `Something went wrong${detail ? `: ${detail}` : ''}.`;
}

const HIDDEN = new Set(['notify']); // the assistant talks in-app; pushes are for schedules only

export type RunOpts = {
  extraSystem?: string;
  allowNotify?: boolean;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Only offer these tools (keeps prompts small and free-tier friendly). */
  toolNames?: string[];
  /** Set when a tool changed data: never retry on another provider after that. */
  state?: { mutated: boolean };
};
const allowed = (opts: RunOpts) =>
  TOOLS.filter((t) => (opts.allowNotify || !HIDDEN.has(t.name)) && (!opts.toolNames || opts.toolNames.includes(t.name)));
const toolsFor = (opts: RunOpts): Anthropic.Beta.BetaTool[] =>
  allowed(opts).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toolJsonSchema(t) as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));

const SYSTEM = `You are Slates, the assistant built into the user's personal dashboard app. You read and change their boards, notes, inbox and reminders with your tools.
- Answer from their data. A snapshot of their boards is below; look up details with your tools before saying you don't know.
- When they ask you to add, tick, move, file or remind, do it with the tools, then confirm in one short sentence what changed and where.
- Notes, plans and write-ups go on the Notes board (add_note). Never paste long text into a dashboard.
- Times: the current time and timezone are in the snapshot; reminders need ISO 8601 with that offset.
- Keep replies short and plain: they are read on a phone. Use Markdown lists only when listing several things. Amounts and dates exactly as stored.
- Never invent numbers. If something isn't in their data, say so.`;

export type AskEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; title: string }
  | { type: 'done'; text: string }
  | { type: 'meta'; mode: 'direct' | 'ai'; changed?: boolean; left?: number }
  | { type: 'error'; message: string };

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** Run the tool loop; emits text deltas and tool activity. Returns the final reply text. */
export async function runAssistant(
  caller: Caller,
  turns: ChatTurn[],
  emit: (e: AskEvent) => void = () => {},
  opts: RunOpts = {},
): Promise<string> {
  const chain = providers();
  if (!chain.length) throw new Error('Ask Slates is not set up yet (no AI key on the server).');
  const state = opts.state ?? { mutated: false };
  const fails: { p: string; e: unknown }[] = [];
  for (const p of chain) {
    try {
      if (p === 'gemini') return await runGemini(caller, turns, emit, { ...opts, state });
      if (p.startsWith('groq:')) return await runOpenAICompat(caller, turns, emit, { ...opts, state }, GROQ, p.slice(5));
      if (p.startsWith('openrouter:')) return await runOpenAICompat(caller, turns, emit, { ...opts, state }, OPENROUTER, p.slice(11));
      return await runAnthropic(caller, turns, emit, { ...opts, state });
    } catch (e) {
      fails.push({ p, e });
      // Fall through to the next free provider only if nothing has been changed yet.
      if (state.mutated || opts.signal?.aborted) throw e;
      console.warn('[ask] provider failed, trying next:', p, (e as { status?: number })?.status ?? '', String((e as Error)?.message).slice(0, 200));
    }
  }
  if (fails.length === 1) throw fails[0].e;
  // Every provider failed: report each one, so the last (often a quota) doesn't hide the real cause.
  const statuses = fails.map((f) => (f.e as { status?: number })?.status);
  throw Object.assign(
    new Error(fails.map((f) => `${f.p}: ${(f.e as { status?: number })?.status ?? ''} ${String((f.e as Error)?.message ?? f.e).slice(0, 160)}`).join(' | ')),
    { status: statuses.every((x) => x === 429) ? 429 : statuses.find((x) => typeof x === 'number' && x !== 429) ?? 500 },
  );
}

async function runAnthropic(caller: Caller, turns: ChatTurn[], emit: (e: AskEvent) => void, opts: RunOpts): Promise<string> {
  const client = new Anthropic();
  const tools = toolsFor(opts);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns
    .filter((t) => t.content.trim())
    .slice(-20)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 8000) }));
  const system = opts.extraSystem ? `${SYSTEM}\n\n${opts.extraSystem}` : SYSTEM;
  let reply = '';
  let jsonRetries = 0;

  for (let step = 0; step < (opts.maxSteps ?? 12); step++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        system,
        tools,
        messages,
      },
      { signal: opts.signal },
    );
    stream.on('text', (delta) => {
      reply += delta;
      emit({ type: 'text', text: delta });
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Only an unparseable streamed tool input is retried; API errors propagate.
      if (err instanceof Anthropic.APIError || opts.signal?.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === 'refusal') {
      const msg = "I can't help with that one.";
      emit({ type: 'text', text: msg });
      return reply + msg;
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || uses.length === 0) return reply;

    messages.push({ role: 'assistant', content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const tool = allowed(opts).find((t) => t.name === use.name);
      emit({ type: 'tool', name: use.name, title: tool?.title ?? use.name });
      if (!tool) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` });
        continue;
      }
      const parsed = tool.input.safeParse(use.input ?? {});
      if (!parsed.success) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Invalid input: ${z.prettifyError(parsed.error)}` });
        continue;
      }
      try {
        if (!tool.readOnly && opts.state) opts.state.mutated = true;
        const out = await tool.run(caller, parsed.data);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out ?? { ok: true }).slice(0, 60000) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: toSlatesError(e).message });
      }
    }
    messages.push({ role: 'user', content: results });
    if (reply && !reply.endsWith('\n')) {
      reply += '\n\n';
      emit({ type: 'text', text: '\n\n' });
    }
  }
  return reply;
}

// ------------------------------------------------------------------ Gemini

/**
 * Gemini function declarations accept a subset of JSON Schema. Drop what it rejects:
 * propertyNames, pattern, uncommon formats, and empty `additionalProperties: {}`
 * (free-form objects stay `type: object`; their description explains the shape).
 */
export function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === '$schema' || k === 'propertyNames' || k === 'pattern') continue;
    if (k === 'format' && v !== 'date-time' && v !== 'enum') continue;
    if (k === 'additionalProperties' && (typeof v !== 'object' || !v || Object.keys(v).length === 0)) continue;
    if (k === 'minimum' && typeof v === 'number' && v <= -Number.MAX_SAFE_INTEGER) continue;
    if (k === 'maximum' && typeof v === 'number' && v >= Number.MAX_SAFE_INTEGER) continue;
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, geminiSchema(pv)])) : geminiSchema(v);
  }
  return out;
}

/** Run one tool call with validation; returns a JSON-able result or an error object. */
async function callTool(caller: Caller, name: string, args: unknown, opts: RunOpts) {
  const tool = allowed(opts).find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) return { error: `Invalid input: ${z.prettifyError(parsed.error)}` };
  try {
    if (!tool.readOnly && opts.state) opts.state.mutated = true;
    const out = await tool.run(caller, parsed.data);
    const json = JSON.stringify(out ?? { ok: true });
    return { output: JSON.parse(json.length > 60000 ? JSON.stringify({ truncated: json.slice(0, 60000) }) : json) };
  } catch (e) {
    return { error: toSlatesError(e).message };
  }
}

/** Gemini's free tier rate-limits per minute; when it says "retry in Ns" (<= 20s), wait once and retry. */
async function sendWithRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { status?: number })?.status;
    const secs = Number(String((e as Error)?.message ?? '').match(/retry(?:Delay"?:\s*"|\s+in\s+)([\d.]+)s/i)?.[1] ?? 'NaN');
    if (status !== 429 || !(secs <= 8) || signal?.aborted) throw e;
    console.warn('[ask] gemini 429, retrying in', secs, 's');
    await new Promise((r) => setTimeout(r, Math.ceil(secs * 1000) + 250));
    return fn();
  }
}

async function runGemini(
  caller: Caller,
  turns: ChatTurn[],
  emit: (e: AskEvent) => void,
  opts: RunOpts,
): Promise<string> {
  // No SDK retries (its default waits up to a minute between 5 tries) and a short timeout,
  // so a throttled free key falls back to the next provider instead of timing out the request.
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } } });
  const recent = turns.filter((t) => t.content.trim()).slice(-20);
  const last = recent.pop()!;
  const chat = ai.chats.create({
    model: GEMINI_MODEL(),
    // Earlier turns are plain text; the SDK keeps this turn's tool calls (and their
    // thought signatures) in its own history as the loop runs.
    history: recent.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content.slice(0, 8000) }] })),
    config: {
      systemInstruction: opts.extraSystem ? `${SYSTEM}\n\n${opts.extraSystem}` : SYSTEM,
      tools: [
        {
          functionDeclarations: allowed(opts).map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: geminiSchema(toolJsonSchema(t)),
          })),
        },
      ],
      abortSignal: opts.signal,
    },
  });

  let reply = '';
  let message: Part[] | string = last.content.slice(0, 8000);
  for (let step = 0; step < (opts.maxSteps ?? 12); step++) {
    const stream = await sendWithRetry(() => chat.sendMessageStream({ message }), opts.signal);
    const calls: { id?: string; name: string; args?: Record<string, unknown> }[] = [];
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) {
          reply += part.text;
          emit({ type: 'text', text: part.text });
        }
        if (part.functionCall?.name) calls.push({ id: part.functionCall.id, name: part.functionCall.name, args: part.functionCall.args });
      }
    }
    if (!calls.length) return reply;
    const responses: Part[] = [];
    for (const c of calls) {
      emit({ type: 'tool', name: c.name, title: TOOLS.find((t) => t.name === c.name)?.title ?? c.name });
      responses.push({ functionResponse: { id: c.id, name: c.name, response: await callTool(caller, c.name, c.args, opts) } });
    }
    message = responses;
    if (reply && !reply.endsWith('\n')) {
      reply += '\n\n';
      emit({ type: 'text', text: '\n\n' });
    }
  }
  return reply;
}

// ------------------------------------------------------------------ Groq (OpenAI-compatible)

type OAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type Compat = { label: string; url: string; headers: () => Record<string, string> };
export const GROQ: Compat = {
  label: 'Groq',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  headers: () => ({ Authorization: `Bearer ${process.env.GROQ_API_KEY}` }),
};
export const OPENROUTER: Compat = {
  label: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  headers: () => ({ Authorization: `Bearer ${openrouterKey()}`, 'HTTP-Referer': 'https://www.slates.space', 'X-Title': 'Slates' }),
};

async function runOpenAICompat(caller: Caller, turns: ChatTurn[], emit: (e: AskEvent) => void, opts: RunOpts, api: Compat, model: string): Promise<string> {
  const tools = allowed(opts).map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: geminiSchema(toolJsonSchema(t)) },
  }));
  const messages: OAIMessage[] = [
    { role: 'system', content: opts.extraSystem ? `${SYSTEM}\n\n${opts.extraSystem}` : SYSTEM },
    ...turns
      .filter((t) => t.content.trim())
      .slice(-12)
      .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }) as OAIMessage),
  ];
  let reply = '';
  for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
    const call = () =>
      fetch(api.url, {
        method: 'POST',
        headers: { ...api.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', max_completion_tokens: 2048 }),
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
    let res = await call();
    // Per-minute caps on free tiers: when the provider says "try again in Ns" and N is short, wait once.
    for (let tries = 0; res.status === 429 && tries < 2; tries++) {
      const body = await res.text();
      const wait = Number(res.headers.get('retry-after')) || Number(body.match(/try again in ([\d.]+)s/i)?.[1]);
      if (!wait || wait > 12) {
        res = new Response(body, { status: 429 });
        break;
      }
      await new Promise((r) => setTimeout(r, wait * 1000 + 250));
      res = await call();
    }
    if (!res.ok) throw Object.assign(new Error(`${api.label} ${model}: ${(await res.text()).slice(0, 400)}`), { status: res.status });
    const msg = (await res.json())?.choices?.[0]?.message as { content?: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] };
    if (msg?.content) {
      reply += msg.content;
      emit({ type: 'text', text: msg.content });
    }
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) return reply;
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      emit({ type: 'tool', name: c.function.name, title: TOOLS.find((t) => t.name === c.function.name)?.title ?? c.function.name });
      let args: unknown = {};
      try {
        args = JSON.parse(c.function.arguments || '{}');
      } catch {
        args = null;
      }
      const out = args === null ? { error: 'Arguments were not valid JSON' } : await callTool(caller, c.function.name, args, opts);
      // Every step resends the whole conversation and free tiers cap tokens per minute: keep results short.
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, 5000) });
    }
    if (reply && !reply.endsWith('\n')) {
      reply += '\n\n';
      emit({ type: 'text', text: '\n\n' });
    }
  }
  return reply;
}

// ------------------------------------------------------------------ one-shot text (no tools)

/**
 * One plain completion through the same providers, in the same order, as Ask (no tools, no
 * Slates system prompt). Gives up on a provider after the time left in `budgetMs` and moves on.
 * Returns null when no provider answers; never throws.
 */
export async function completeText(system: string, prompt: string, { budgetMs = 9000, maxTokens = 1200 }: { budgetMs?: number; maxTokens?: number } = {}): Promise<string | null> {
  const end = Date.now() + budgetMs;
  for (const p of providers()) {
    const left = end - Date.now();
    if (left < 1500) break;
    const signal = AbortSignal.timeout(left);
    try {
      let out = '';
      if (p === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: left, retryOptions: { attempts: 1 } } });
        const r = await ai.models.generateContent({ model: GEMINI_MODEL(), contents: prompt, config: { systemInstruction: system, maxOutputTokens: maxTokens, abortSignal: signal } });
        out = r.text ?? '';
      } else if (p.startsWith('groq:') || p.startsWith('openrouter:')) {
        const api = p.startsWith('groq:') ? GROQ : OPENROUTER;
        const res = await fetch(api.url, {
          method: 'POST',
          headers: { ...api.headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: p.slice(p.indexOf(':') + 1),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            max_completion_tokens: maxTokens,
          }),
          signal,
        });
        if (!res.ok) throw Object.assign(new Error(`${api.label}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
        out = (await res.json())?.choices?.[0]?.message?.content ?? '';
      } else {
        const r = await new Anthropic().messages.create({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, { signal });
        out = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      }
      if (out.trim()) return out.trim();
    } catch (e) {
      console.warn('[complete] provider failed, trying next:', p, (e as { status?: number })?.status ?? '', String((e as Error)?.message).slice(0, 160));
    }
  }
  return null;
}
