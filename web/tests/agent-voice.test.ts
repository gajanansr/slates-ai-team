import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DAIRY_REPLY } from './studio-fixture';
import { freshDb, userCaller } from './helpers';
import { BlueprintSchema, repairBlueprint } from '@/lib/studio/blueprint';
import { applyBlueprint, getAgent, manifestBody, setAgentVoice, type AgentManifest } from '@/lib/studio/build';
import { DEFAULT_INDIA_VOICE, DEFAULT_VOICE, INTRO_MAX_WORDS, VOICES, introKey, introText, resolveVoice, voiceOf, voiceOptions, wordCount } from '@/lib/voices';
import { MURF_STREAM, agentIntro, introPath } from '@/lib/studio/intro';
import { AGENT_CALL_TOOLS, boardStatus, personaFor, personaGreeting } from '@/lib/agent-call';
import { joinBody } from '@/lib/call';
import { startCall } from '@/lib/call-server';
import { TOOL_BY_NAME } from '@/lib/agent/tools';

vi.mock('server-only', () => ({}));

beforeAll(() => {
  process.env.SLATES_ENC_KEY ??= randomBytes(32).toString('base64');
});

const clone = <T,>(v: T): T => structuredClone(v);

// ------------------------------------------------------------------ voices + blueprint

describe('agent voices', () => {
  it('the curated list is unique, and each locale is the id prefix', () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
    for (const v of VOICES) expect(v.id.startsWith(`${v.locale}-`)).toBe(true);
    expect(voiceOf('en-IN-aarav')).toMatchObject({ name: 'Aarav', locale: 'en-IN', accent: 'Indian English' });
  });

  it('blueprints keep a listed voice and repair anything else to the regional default', () => {
    const ok = repairBlueprint({ ...clone(DAIRY_REPLY), voice: 'en-IN-priya' }, 'dairy');
    expect(ok.blueprint.voice).toBe('en-IN-priya');
    expect(ok.repairs.some((r) => r.startsWith('voice'))).toBe(false);

    const byName = repairBlueprint({ ...clone(DAIRY_REPLY), voice: 'Aarav (M)' }, 'dairy');
    expect(byName.blueprint.voice).toBe('en-IN-aarav');

    const india = repairBlueprint({ ...clone(DAIRY_REPLY), voice: 'en-IN-rohan' }, 'dairy', { timezone: 'Asia/Kolkata' });
    expect(india.blueprint.voice).toBe(DEFAULT_INDIA_VOICE);
    expect(india.repairs.some((r) => r.includes('en-IN-rohan'))).toBe(true);
    expect(repairBlueprint({ ...clone(DAIRY_REPLY), voice: 42 }, 'dairy', { timezone: 'Europe/Berlin' }).blueprint.voice).toBe(DEFAULT_VOICE);
    expect(repairBlueprint(clone(DAIRY_REPLY), 'dairy').blueprint.voice).toBe(DEFAULT_VOICE);

    // The schema itself only takes listed ids.
    expect(BlueprintSchema.safeParse({ ...ok.blueprint, voice: 'en-US-nobody' }).success).toBe(false);
    expect(BlueprintSchema.safeParse(ok.blueprint).success).toBe(true);
    expect(resolveVoice('EN-us-Natalie')).toBe('en-US-natalie');
  });

  it('the picker offers 3-6 voices, current first, same accent next', () => {
    const opts = voiceOptions('en-IN-aarav');
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts.length).toBeLessThanOrEqual(6);
    expect(opts[0].id).toBe('en-IN-aarav');
    expect(opts.slice(0, 4).every((v) => v.locale === 'en-IN')).toBe(true);
    expect(opts.some((v) => v.gender === 'female')).toBe(true);
    expect(voiceOptions('junk')[0].id).toBe(DEFAULT_VOICE);
  });
});

// ------------------------------------------------------------------ intro

describe('intro', () => {
  const agent = { name: 'Dairy Manager', mission: 'Keeps your milk collection, deliveries, customer dues, feed stock and herd health in one place, every day.' };

  it('is first person, greets by first name and stays within 35 words', () => {
    const t = introText(agent, 'Ada Lovelace');
    expect(t).toMatch(/^Hi Ada, I'm your Dairy Manager\. I'll keep your milk collection/);
    expect(wordCount(t)).toBeLessThanOrEqual(INTRO_MAX_WORDS);
    const long = introText({ name: 'Launch Captain', mission: `Watches ${'every single little thing about the launch '.repeat(8)}` }, null);
    expect(long).toMatch(/^Hi, I'm your Launch Captain\. I'll watch every/);
    expect(wordCount(long)).toBeLessThanOrEqual(INTRO_MAX_WORDS);
    expect(introText({ name: 'Coach', mission: 'Your weekly training plan.' }, 'Bo')).toBe("Hi Bo, I'm your Coach. My job: your weekly training plan. Call me any time.");
  });

  it('is cached by (agent, voice, text)', () => {
    const t = introText(agent, 'Ada');
    const k = introKey('dairy-manager', 'en-IN-aarav', t);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(introKey('dairy-manager', 'en-IN-aarav', t)).toBe(k);
    expect(introKey('dairy-manager', 'en-IN-priya', t)).not.toBe(k);
    expect(introKey('dairy-manager', 'en-IN-aarav', `${t} `)).not.toBe(k);
    expect(introKey('fitness-coach', 'en-IN-aarav', t)).not.toBe(k);
    expect(introPath('u1', 'dairy-manager', 'en-IN-aarav', t)).toBe(`u1/agent-voice/dairy-manager-${k}.mp3`);
  });

  function fakeStorage(stored: Set<string>) {
    const upload = vi.fn(async (path: string) => {
      stored.add(path);
      return { data: { path }, error: null };
    });
    const createSignedUrl = vi.fn(async (path: string) => (stored.has(path) ? { data: { signedUrl: `https://files/${path}?sig` }, error: null } : { data: null, error: { message: 'Object not found' } }));
    return { sb: { storage: { from: () => ({ upload, createSignedUrl }) } } as any, upload, createSignedUrl };
  }
  const m = { slug: 'dairy-manager', voice: 'en-IN-aarav', ...agent };

  it('makes the clip once with Murf FALCON, stores it in the user folder, then serves it from storage', async () => {
    const stored = new Set<string>();
    const { sb, upload } = fakeStorage(stored);
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const deps = { sb, userId: 'u1', env: { MURF_API_KEY: 'murf-test' }, fetch: fetch as any };

    expect(await agentIntro(deps, m, 'Ada')).toMatchObject({ url: null, cached: false, voice: 'en-IN-aarav', label: 'Aarav, Indian English' });
    expect(fetch).not.toHaveBeenCalled();

    const made = await agentIntro(deps, m, 'Ada', { generate: true });
    expect(made.url).toMatch(/^https:\/\/files\/u1\/agent-voice\/dairy-manager-[0-9a-f]{16}\.mp3/);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(MURF_STREAM);
    expect((init.headers as Record<string, string>)['api-key']).toBe('murf-test');
    expect(JSON.parse(init.body as string)).toMatchObject({ voiceId: 'en-IN-aarav', locale: 'en-IN', model: 'FALCON', format: 'MP3', text: introText(agent, 'Ada') });
    expect(upload.mock.calls[0][0]).toBe(introPath('u1', 'dairy-manager', 'en-IN-aarav', made.text));

    const again = await agentIntro(deps, m, 'Ada', { generate: true });
    expect(again).toMatchObject({ url: made.url, cached: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly without a Murf key or when Murf refuses', async () => {
    const { sb, upload } = fakeStorage(new Set());
    await expect(agentIntro({ sb, userId: 'u1', env: {} }, m, null, { generate: true })).rejects.toMatchObject({ status: 503 });
    const refuse = vi.fn(async () => new Response('{"error":"x"}', { status: 402 }));
    await expect(agentIntro({ sb, userId: 'u1', env: { MURF_API_KEY: 'k' }, fetch: refuse as any }, m, null, { generate: true })).rejects.toMatchObject({ status: 502 });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('voice in the manifest', () => {
  it('a built agent keeps its voice, and changing it rewrites the manifest', async () => {
    const pg = await freshDb();
    const c = userCaller(pg);
    const bp = repairBlueprint({ ...clone(DAIRY_REPLY), voice: 'en-IN-isha' }, 'dairy').blueprint;
    const m = await applyBlueprint(c, bp, { goal: 'dairy', timezone: 'Asia/Kolkata' });
    expect(m.voice).toBe('en-IN-isha');
    expect((await getAgent(c, 'dairy-manager'))?.voice).toBe('en-IN-isha');
    await setAgentVoice(c, 'dairy-manager', 'en-IN-aarav');
    expect((await getAgent(c, 'dairy-manager'))?.voice).toBe('en-IN-aarav');
    await expect(setAgentVoice(c, 'nobody', 'en-IN-aarav')).rejects.toMatchObject({ status: 404 });
  });
});

// ------------------------------------------------------------------ talk to an agent

const ENV = { AGORA_APP_ID: 'a'.repeat(32), AGORA_APP_CERTIFICATE: 'b'.repeat(32), MURF_API_KEY: 'murf-test' };
const cfg = { appId: ENV.AGORA_APP_ID, cert: ENV.AGORA_APP_CERTIFICATE, murfKey: ENV.MURF_API_KEY };

const manifest: AgentManifest = {
  studio: 1,
  slug: 'dairy-manager',
  name: 'Dairy Manager',
  icon: 'leaf',
  color: 'green',
  voice: 'en-IN-aarav',
  mission: 'Keeps your milk collection, deliveries and dues on track.',
  space: 'Dairy Manager',
  goal: 'manage my dairy business',
  boards: [
    { slug: 'dairy-manager-today', title: 'Today at the dairy', kind: 'dashboard' },
    { slug: 'dairy-manager-routine', title: 'Daily Routine', kind: 'list' },
  ],
  routines: [],
  reminders: [],
  notes: [],
  playbook: 'agent-dairy-manager',
  questions: [],
  created_at: '2026-11-20T00:00:00.000Z',
  updated_at: '2026-11-20T00:00:00.000Z',
};
const routine = { slug: 'dairy-manager-routine', title: 'Daily Routine', kind: 'list', data: { items: [{ id: 'a', text: 'Milk', done: true }, { id: 'b', text: 'Feed' }, { id: 'c', text: 'Deliver' }] } } as any;

describe('agent persona', () => {
  const persona = personaFor(manifest, { firstName: 'Ada Lovelace', playbook: '## Routines\n- Morning collection check', live: [routine] });

  it('speaks as the agent, in its Murf voice, with a greeting from its boards', () => {
    expect(persona).toMatchObject({ name: 'Dairy Manager', voiceId: 'en-IN-aarav', locale: 'en-IN' });
    expect(persona.greeting).toBe("Hi Ada, it's your Dairy Manager. 2 of 3 tasks left on Daily Routine. What do you need?");
    expect(personaGreeting('Coach', null)).toBe("Hi, it's your Coach. What do you need?");
    expect(boardStatus([])).toBeNull();
    expect(persona.system).toContain(manifest.mission);
    expect(persona.system).toContain('Morning collection check');
    expect(persona.system).toContain('dairy-manager-routine');
    expect(persona.boards).toEqual(['dairy-manager-today', 'dairy-manager-routine', 'notes', 'desk']);
  });

  it('join body: its voice, its prompt, the per-call token, and no build_agent', () => {
    const body = joinBody(cfg, { channel: 'slates-x', hostToken: 'HOST', slatesToken: 'slt_agentcall', greeting: 'ignored', persona });
    expect(body.properties.tts.params).toMatchObject({ voiceId: 'en-IN-aarav', locale: 'en-IN', model: 'FALCON', api_key: 'murf-test' });
    expect(body.properties.llm.system_messages[0].content).toContain(manifest.mission);
    expect(body.properties.llm.greeting_message).toBe(persona.greeting);
    const [mcp] = body.properties.llm.mcp_servers;
    expect(mcp.headers.Authorization).toBe('Bearer slt_agentcall');
    expect(mcp.allowed_tools).toEqual([...AGENT_CALL_TOOLS]);
    expect(mcp.allowed_tools).not.toContain('build_agent');
    for (const t of mcp.allowed_tools) {
      expect(TOOL_BY_NAME.has(t), t).toBe(true);
      expect(t).not.toMatch(/archive|delete|restore|automation|cancel|reorder|update_slate|set_app_layout|create_slate/);
    }
    for (const t of ['get_slate', 'patch_items', 'add_note', 'update_note', 'remind', 'list_reminders', 'hand_off', 'notify']) expect(mcp.allowed_tools).toContain(t);
    // Without a persona nothing changes: Slates keeps its own voice.
    expect(joinBody(cfg, { channel: 'c', hostToken: 'h', slatesToken: 's', greeting: 'g' }).properties.tts.params.voiceId).toBe('en-US-natalie');
  });
});

function fakeSb(agents: Record<string, AgentManifest>) {
  const rpc = vi.fn(async (fn: string, args: Record<string, any>) => {
    if (fn === 'create_agent') return { data: { token: 'slt_agentcall', agent: { id: 'sa1' } }, error: null };
    if (fn === 'revoke_agent') return { data: null, error: null };
    if (fn === 'slates_exec') {
      const slug = args.p_args?.slug;
      if (args.p_op === 'list') return { data: [routine], error: null };
      if (args.p_op === 'get' && slug === 'notes') {
        return { data: { slug: 'notes', kind: 'notes', version: 1, data: { items: [{ id: 'agent-dairy-manager', title: 'How it works', body: 'Check the morning collection.' }] } }, error: null };
      }
      const m = Object.values(agents).find((a) => `agent-${a.slug}` === slug);
      if (args.p_op === 'get' && m) return { data: { slug, kind: 'markdown', hidden: true, data: { body: manifestBody(m) } }, error: null };
      return { data: null, error: { code: 'P0404', message: `slate "${slug}" not found` } };
    }
    return { data: null, error: null };
  });
  const query: any = { select: () => query, eq: () => query, is: () => query, lt: () => query, limit: async () => ({ data: [], error: null }) };
  return { sb: { rpc, from: () => query } as any, rpc };
}

describe('startCall with an agent', () => {
  it('scopes the per-call token to the agent boards and joins with its persona', async () => {
    const { sb, rpc } = fakeSb({ dairy: manifest });
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ agent_id: 'ag1', status: 'RUNNING' }), { status: 200 }));
    const out = await startCall({ sb, fetch: fetch as any, env: { ...ENV, RUNNER_URL: 'https://runner.example', ASK_SECRET: 's' } }, { id: 'u1', firstName: 'Ada' }, { agent: 'dairy-manager', mode: 'standup' });

    const create = rpc.mock.calls.find((c) => c[0] === 'create_agent')!;
    expect(create[1]).toMatchObject({ p_scopes: ['read', 'write'], p_days: 1, p_boards: ['dairy-manager-today', 'dairy-manager-routine', 'notes', 'desk'] });
    // One join only (no live voices, no standup), with the agent's voice and the scoped token.
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(sent.properties.tts.params.voiceId).toBe('en-IN-aarav');
    expect(sent.properties.llm.greeting_message).toBe("Hi Ada, it's your Dairy Manager. 2 of 3 tasks left on Daily Routine. What do you need?");
    expect(sent.properties.llm.system_messages[0].content).toContain('Check the morning collection.');
    expect(sent.properties.llm.mcp_servers[0].headers.Authorization).toBe('Bearer slt_agentcall');
    expect(sent.properties.llm.mcp_servers[0].allowed_tools).not.toContain('build_agent');
    expect(sent.properties.llm.tools).toBeUndefined();
    expect(out.participants).toEqual([{ uid: 1000, name: 'Dairy Manager', line: 'Your agent' }]);
    expect(out.agent).toEqual({ slug: 'dairy-manager', name: 'Dairy Manager', icon: 'leaf', color: 'green' });
    expect(out.standup).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('slt_agentcall');
  });

  it('answers 404 for an unknown or malformed agent, before any token or join', async () => {
    const { sb, rpc } = fakeSb({});
    const fetch = vi.fn();
    await expect(startCall({ sb, fetch: fetch as any, env: ENV }, { id: 'u1', firstName: null }, { agent: 'nobody' })).rejects.toMatchObject({ status: 404 });
    await expect(startCall({ sb, fetch: fetch as any, env: ENV }, { id: 'u1', firstName: null }, { agent: '../etc' })).rejects.toMatchObject({ status: 404 });
    await expect(startCall({ sb, fetch: fetch as any, env: ENV }, { id: 'u1', firstName: null }, { agent: 42 })).rejects.toMatchObject({ status: 404 });
    expect(rpc.mock.calls.some((c) => c[0] === 'create_agent')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
