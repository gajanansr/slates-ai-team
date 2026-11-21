import { slates, SlatesError, type Caller } from '@/lib/slates';
import { notes } from '@/lib/notes';
import { reminders } from '@/lib/reminders';
import { isoInZone } from '@/lib/when';
import type { Slate, SlateKind } from '@/lib/kinds';
import {
  agentSlug,
  boardSlug,
  describeSchedule,
  firstReminderAt,
  manifestSlug,
  nextRun,
  playbookId,
  starterNoteId,
  type AgentColor,
  type Blueprint,
  type Schedule,
} from '@/lib/studio/blueprint';

/**
 * Agent Studio builder: applies a blueprint for the caller (the signed-in user or an agent
 * token) through the same service layer every other write uses (slates_exec via lib/slates,
 * lib/notes, lib/reminders). Safe to retry: boards, notes and the manifest have stable slugs
 * derived from the agent name, existing pieces are kept, reminders and automations are
 * matched by text/title so a retry never doubles them.
 *
 * The agent itself is a hidden markdown board (slug "agent-<slug>") holding a JSON manifest,
 * like the Desk and the Inbox: versioned, owner-scoped, no schema of its own.
 */

export type ManifestRoutine = {
  title: string;
  schedule: Schedule;
  does: string;
  /** automation: an existing automation runs it. playbook: written in the agent's playbook for agents to follow. */
  mode: 'automation' | 'playbook';
  automation_id?: string;
  note?: string;
};
export type AgentManifest = {
  studio: 1;
  slug: string;
  name: string;
  icon: string;
  color: AgentColor;
  /** Murf voice id (lib/voices.ts). Agents built before voices have none: voiceOf() picks the regional default. */
  voice?: string;
  mission: string;
  space: string;
  goal: string;
  boards: { slug: string; title: string; kind: SlateKind; purpose?: string }[];
  routines: ManifestRoutine[];
  reminders: { text: string; repeat?: string; time: string }[];
  notes: { id: string; title: string }[];
  playbook: string;
  questions: string[];
  created_at: string;
  updated_at: string;
};

export type PieceKind = 'board' | 'note' | 'routine' | 'reminder';
export type BuildEvent =
  | { type: 'stage'; text: string }
  | { type: 'blueprint'; name: string; icon: string; color: AgentColor; mission: string; pieces: { piece: PieceKind; title: string }[] }
  | { type: 'piece'; piece: PieceKind; title: string; status: 'created' | 'kept' | 'scheduled' | 'recorded'; href?: string; detail?: string }
  | { type: 'done'; slug: string; url: string; summary: string }
  /** After done: the agent's spoken intro (Murf), when it could be made. */
  | { type: 'intro'; url: string; text: string; voice: string; label: string }
  | { type: 'error'; message: string };

export type AutomationPort = {
  list: () => Promise<{ id: string; kind: string; title: string; next_run_at?: string | null }[]>;
  save: (input: { kind: 'rss' | 'brief' | 'recap'; title: string; every: Schedule['every']; at_hour: number | null; at_weekday: number | null; config: Record<string, unknown> }) => Promise<{ id: string; next_run_at?: string | null }>;
};

export type BuildOpts = { goal: string; timezone: string; now?: Date; automations?: AutomationPort; emit?: (e: BuildEvent) => void };

const MANIFEST_OPEN = '```json\n';
const MANIFEST_NOTE = 'Agent Studio keeps this agent here. Edit the agent from its page instead of this board.\n\n';

export function manifestBody(m: AgentManifest) {
  return `${MANIFEST_NOTE}${MANIFEST_OPEN}${JSON.stringify(m, null, 1)}\n\`\`\``;
}

/** Read a manifest back from its board; null when the board is not an Agent Studio manifest. */
export function parseManifest(s: Pick<Slate, 'kind' | 'data' | 'slug'> | null | undefined): AgentManifest | null {
  if (!s || s.kind !== 'markdown' || !s.slug.startsWith('agent-')) return null;
  const body = String((s.data as { body?: unknown }).body ?? '');
  const json = body.match(/```json\n([\s\S]*?)\n```/)?.[1];
  if (!json) return null;
  try {
    const m = JSON.parse(json);
    return m && m.studio === 1 && typeof m.slug === 'string' && typeof m.name === 'string' && Array.isArray(m.boards) ? (m as AgentManifest) : null;
  } catch {
    return null;
  }
}

/** Every agent the caller has built, newest first. */
export async function listAgents(c: Caller): Promise<{ manifest: AgentManifest; updated_at: string }[]> {
  const all = await slates.list(c);
  return all
    .map((s) => ({ manifest: parseManifest(s), updated_at: s.updated_at }))
    .filter((x): x is { manifest: AgentManifest; updated_at: string } => !!x.manifest)
    .sort((a, b) => b.manifest.created_at.localeCompare(a.manifest.created_at));
}

export async function getAgent(c: Caller, slug: string): Promise<AgentManifest | null> {
  try {
    return parseManifest(await slates.get(c, manifestSlug(slug)));
  } catch (e) {
    if (e instanceof SlatesError && (e.status === 404 || e.status === 422)) return null;
    throw e;
  }
}

/** Change an agent's voice: rewrites its manifest (versioned like any board). */
export async function setAgentVoice(c: Caller, slug: string, voice: string): Promise<AgentManifest> {
  const m = await getAgent(c, slug);
  if (!m) throw new SlatesError(`No agent "${slug}".`, 404, 'not_found');
  if (m.voice === voice) return m;
  const next: AgentManifest = { ...m, voice };
  await slates.update(c, manifestSlug(m.slug), { data: { body: manifestBody(next) }, note: `Changed the ${m.name} voice` });
  return next;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function playbookBody(bp: Blueprint, m: Pick<AgentManifest, 'boards' | 'routines' | 'notes'>, tz: string) {
  const lines = [`${bp.mission}`, '', '## Boards'];
  for (const b of m.boards) lines.push(`- [${b.title}](/s/${b.slug})${b.purpose ? `: ${b.purpose}` : ''}`);
  if (m.routines.length) {
    lines.push('', '## Routines');
    for (const r of m.routines) lines.push(`- **${r.title}** (${describeSchedule(r.schedule)}, ${tz}): ${r.does}${r.mode === 'automation' ? ' _Runs automatically._' : ''}`);
  }
  if (bp.reminders.length) {
    lines.push('', '## Reminders');
    for (const r of bp.reminders) lines.push(`- ${r.text} at ${r.time}${r.repeat ? `, ${r.repeat}` : ''}`);
  }
  if (bp.questions.length) {
    lines.push('', '## Make it yours', 'Answer these (tell any agent, or edit this note) so it fits how you work:');
    for (const q of bp.questions) lines.push(`- [ ] ${q}`);
  }
  if (m.notes.length) {
    lines.push('', '## Notes');
    for (const n of m.notes) lines.push(`- [${n.title}](/notes/${n.id})`);
  }
  lines.push(
    '',
    '## For agents',
    `When the user asks for ${bp.name}, or a routine above is due, work on these boards: keep the numbers and tables current, tick what is done, and log what you changed. Routines without "Runs automatically" are yours to do at their time. Ask before deleting anything; never fill in personal details you were not given. Rows marked "(example)" are placeholders the user replaces.`,
  );
  return lines.join('\n');
}

/** First free slug for a board: reuse one that already belongs to this agent (retry), skip ones used by anything else. */
function pickSlug(taken: Map<string, Slate>, agent: string, title: string, space: string, claimed: Set<string>) {
  for (let n = 1; n < 20; n++) {
    const slug = boardSlug(agent, title, n);
    if (claimed.has(slug)) continue;
    const s = taken.get(slug);
    if (!s) return { slug, existing: null };
    if (s.category === space && !s.archived_at) return { slug, existing: s };
  }
  throw new SlatesError(`No free board address for "${title}"`, 409, 'conflict');
}

export async function applyBlueprint(c: Caller, bp: Blueprint, opts: BuildOpts): Promise<AgentManifest> {
  const emit = opts.emit ?? (() => {});
  const now = opts.now ?? new Date();
  const tz = opts.timezone;
  const slug = agentSlug(bp.name);
  const mSlug = manifestSlug(slug);
  const pbId = playbookId(slug);

  const all = await slates.list(c, { include_archived: true });
  const taken = new Map(all.map((s) => [s.slug, s]));
  const prior = taken.get(mSlug);
  const previous = parseManifest(prior);
  if (prior && !previous) throw new SlatesError(`The board "${mSlug}" already exists and is not an agent. Rename it, or give the agent another name.`, 409, 'conflict');

  // 1. Boards, in the agent's own category. The first dashboard links the playbook note.
  const boards: AgentManifest['boards'] = [];
  const claimed = new Set<string>();
  let linked = false;
  for (const b of bp.boards) {
    const { slug: s, existing } = pickSlug(taken, slug, b.title, bp.space, claimed);
    claimed.add(s);
    let data = b.data;
    if (b.kind === 'dashboard' && !linked) {
      linked = true;
      const widgets = (data.widgets as { id: string }[]) ?? [];
      if (widgets.length < 24 && !widgets.some((w) => w.id === 'how-it-works')) {
        data = { ...data, widgets: [...widgets, { id: 'how-it-works', title: 'How it works', kind: 'note', size: 'm', data: { note: pbId } }] };
      }
    }
    if (existing) {
      emit({ type: 'piece', piece: 'board', title: b.title, status: 'kept', href: `/s/${s}` });
    } else {
      await slates.create(c, { slug: s, title: b.title, kind: b.kind, data, icon: b.icon ?? bp.icon, category: bp.space, note: `Built by Agent Studio for ${bp.name}` });
      emit({ type: 'piece', piece: 'board', title: b.title, status: 'created', href: `/s/${s}` });
    }
    boards.push({ slug: s, title: existing?.title ?? b.title, kind: b.kind, ...(b.purpose ? { purpose: b.purpose } : {}) });
  }

  // 2. Starter notes (kept if they already exist), tagged with the space so they sit with the boards.
  const have = new Set((await notes.list(c)).map((n) => n.id));
  const made: AgentManifest['notes'] = [];
  for (const n of bp.notes) {
    const id = starterNoteId(slug, n.title);
    if (id === pbId) continue;
    if (have.has(id)) emit({ type: 'piece', piece: 'note', title: n.title, status: 'kept', href: `/notes/${id}` });
    else {
      await notes.add(c, { id, title: n.title, body: n.body, tags: [bp.space] });
      emit({ type: 'piece', piece: 'note', title: n.title, status: 'created', href: `/notes/${id}` });
    }
    made.push({ id, title: n.title });
  }

  // 3. Routines: an existing automation when one fits, otherwise the agent's playbook.
  const routines: ManifestRoutine[] = [];
  const existingAutos = opts.automations && bp.routines.some((r) => r.automation) ? await opts.automations.list().catch(() => []) : [];
  for (const r of bp.routines) {
    const base = { title: r.title, schedule: r.schedule, does: r.does };
    let routine: ManifestRoutine = { ...base, mode: 'playbook' };
    if (r.automation && opts.automations) {
      const same = existingAutos.find((a) => a.title === r.title || (r.automation!.kind !== 'rss' && a.kind === r.automation!.kind));
      if (same) routine = { ...base, mode: same.title === r.title ? 'automation' : 'playbook', automation_id: same.title === r.title ? same.id : undefined, note: same.title === r.title ? undefined : `You already have "${same.title}"` };
      else {
        try {
          const config: Record<string, unknown> = {};
          if (r.automation.url) config.url = r.automation.url;
          if (r.automation.source) config.source = r.automation.source;
          const saved = await opts.automations.save({ kind: r.automation.kind, title: r.title, every: r.schedule.every, at_hour: r.schedule.at_hour ?? null, at_weekday: r.schedule.at_weekday ?? null, config });
          routine = { ...base, mode: 'automation', automation_id: saved.id };
        } catch (e) {
          routine = { ...base, mode: 'playbook', note: (e as Error).message.slice(0, 160) };
        }
      }
    }
    routines.push(routine);
    emit({ type: 'piece', piece: 'routine', title: r.title, status: routine.mode === 'automation' ? 'scheduled' : 'recorded', detail: `${describeSchedule(r.schedule)} · next ${nextRun(r.schedule, tz, now).toISOString()}` });
  }

  // 4. Reminders, matched by text so a retry doesn't double them.
  const open = new Set((await reminders.list(c).catch(() => [])).map((r) => r.text.trim().toLowerCase()));
  for (const r of bp.reminders) {
    if (open.has(r.text.trim().toLowerCase())) {
      emit({ type: 'piece', piece: 'reminder', title: r.text, status: 'kept' });
      continue;
    }
    await reminders.create(c, { text: r.text, at: isoInZone(firstReminderAt(r, tz, now), tz), repeat: r.repeat, slug: boards[0]?.slug, timezone: tz });
    open.add(r.text.trim().toLowerCase());
    emit({ type: 'piece', piece: 'reminder', title: r.text, status: 'created' });
  }

  // 5. The playbook note: how the agent works, for the user and for every other agent.
  const title = `How your ${bp.name} works`.slice(0, 120);
  await notes.add(c, { id: pbId, title, body: playbookBody(bp, { boards, routines, notes: made }, tz), tags: ['playbook', bp.space] });
  emit({ type: 'piece', piece: 'note', title, status: have.has(pbId) ? 'kept' : 'created', href: `/notes/${pbId}` });

  // 6. The manifest. A retry keeps boards an earlier build made.
  const stamp = now.toISOString();
  const manifest: AgentManifest = {
    studio: 1,
    slug,
    name: bp.name,
    icon: bp.icon,
    color: bp.color,
    ...((bp.voice ?? previous?.voice) ? { voice: bp.voice ?? previous?.voice } : {}),
    mission: bp.mission,
    space: bp.space,
    goal: opts.goal.slice(0, 500),
    boards: [...boards, ...(previous?.boards ?? []).filter((b) => !boards.some((x) => x.slug === b.slug))],
    routines,
    reminders: bp.reminders.map((r) => ({ text: r.text, time: r.time, ...(r.repeat ? { repeat: r.repeat } : {}) })),
    notes: made,
    playbook: pbId,
    questions: bp.questions,
    created_at: previous?.created_at ?? stamp,
    updated_at: stamp,
  };
  const data = { body: manifestBody(manifest) };
  if (prior) await slates.update(c, mSlug, { data, title: bp.name, icon: bp.icon, hidden: true, note: `Updated the ${bp.name} agent` });
  else {
    await slates.create(c, { slug: mSlug, title: bp.name, kind: 'markdown', data, icon: bp.icon, note: `Built the ${bp.name} agent` });
    await slates.update(c, mSlug, { hidden: true });
  }
  return manifest;
}

/** One or two sentences a voice agent can say out loud. */
export function spokenSummary(m: AgentManifest) {
  const titles = m.boards.slice(0, 4).map((b) => b.title);
  const list = titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
  const extra = [m.routines.length ? plural(m.routines.length, 'routine') : '', m.reminders.length ? plural(m.reminders.length, 'reminder') : ''].filter(Boolean).join(' and ');
  const ask = m.questions[0] ? ` To make it yours: ${m.questions[0]}` : '';
  return `${m.name} is ready. It has ${plural(m.boards.length, 'board')}: ${list}${extra ? `, plus ${extra}` : ''}.${ask}`;
}
