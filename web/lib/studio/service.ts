import 'server-only';
import { slates, SlatesError, type Caller } from '@/lib/slates';
import { reminders } from '@/lib/reminders';
import { SITE_URL } from '@/lib/env';
import { applyBlueprint, spokenSummary, type AgentManifest, type AutomationPort, type BuildEvent } from '@/lib/studio/build';
import { describeSchedule } from '@/lib/studio/blueprint';
import { generateBlueprint } from '@/lib/studio/generate';
import { buildsInLastDay, BUILD_LOG, BUILD_FAILED_LOG, DAILY_BUILDS } from '@/lib/studio/limits';

export const agentPath = (slug: string) => `/agents/studio/${slug}`;
export const agentUrl = (slug: string) => `${SITE_URL}${agentPath(slug)}`;

/** Automations through whichever door the caller has: the agent token, or the signed-in session. */
function automationPort(c: Caller): AutomationPort {
  const viaToken = async <T,>(op: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await c.client.rpc('agent_automations_exec', { p_op: op, p_args: args, p_token: c.token });
    if (error) throw new SlatesError(error.message, 422, 'invalid');
    return data as T;
  };
  return {
    list: async () => {
      const { automationsRpc } = await import('@/lib/automations');
      return c.token ? viaToken('list') : automationsRpc(c.client, 'list');
    },
    save: async (input) => {
      const { automationsRpc, ensureAssistant, prepareAutomation } = await import('@/lib/automations');
      const prep = prepareAutomation(input.kind, input.config);
      if (!prep.ok) throw new SlatesError(prep.error, 422, 'invalid');
      const args = { ...input, title: input.title.slice(0, 80), config: prep.config };
      if (c.token) return viaToken('save', args);
      await ensureAssistant(c.client);
      return automationsRpc(c.client, 'save', args);
    },
  };
}

export type BuildResult = { manifest: AgentManifest; url: string; path: string; summary: string };

/**
 * Goal -> blueprint -> boards, notes, routines and reminders, for the caller. Checks scope and
 * the daily limit before spending a model call; every attempt (built or failed) counts.
 */
export async function buildAgent(
  c: Caller,
  input: { goal: string; details?: string },
  emit: (e: BuildEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<BuildResult> {
  const goal = input.goal.trim();
  if (goal.length < 3) throw new SlatesError('Say what the agent should do, e.g. "manage my dairy business".', 422, 'invalid');
  if (c.token) {
    const me = await slates.whoami(c);
    if (!me.scopes.includes('write')) throw new SlatesError('build_agent needs a token with write access.', 403, 'forbidden');
    if ((me as { boards?: string[] | null }).boards) throw new SlatesError('build_agent creates new boards, so it needs a token that is not limited to some boards.', 403, 'forbidden');
  }
  const used = await buildsInLastDay(c);
  if (used >= DAILY_BUILDS) throw new SlatesError(`You've built ${DAILY_BUILDS} agents in the last 24 hours, the most for a day. Try again tomorrow, or edit one you have.`, 429, 'rate_limited');

  const ctx = await reminders.context(c).catch(() => ({ now: new Date().toISOString(), timezone: 'Asia/Kolkata' }));
  emit({ type: 'stage', text: 'Designing your agent' });
  let manifest: AgentManifest;
  try {
    const { blueprint } = await generateBlueprint(goal, input.details, { timezone: ctx.timezone, signal });
    emit({
      type: 'blueprint',
      name: blueprint.name,
      icon: blueprint.icon,
      color: blueprint.color,
      mission: blueprint.mission,
      pieces: [
        ...blueprint.boards.map((b) => ({ piece: 'board' as const, title: b.title })),
        ...blueprint.routines.map((r) => ({ piece: 'routine' as const, title: r.title })),
        ...blueprint.reminders.map((r) => ({ piece: 'reminder' as const, title: r.text })),
        ...blueprint.notes.map((n) => ({ piece: 'note' as const, title: n.title })),
      ],
    });
    emit({ type: 'stage', text: `Building ${blueprint.name}` });
    manifest = await applyBlueprint(c, blueprint, { goal, timezone: ctx.timezone, automations: automationPort(c), emit });
  } catch (e) {
    await slates.log(c, `${BUILD_FAILED_LOG}: ${goal.slice(0, 80)}`).catch(() => undefined);
    throw e;
  }
  await slates.log(c, `${BUILD_LOG} "${manifest.name}"`).catch(() => undefined);
  const result = { manifest, url: agentUrl(manifest.slug), path: agentPath(manifest.slug), summary: spokenSummary(manifest) };
  emit({ type: 'done', slug: manifest.slug, url: result.path, summary: result.summary });
  return result;
}

/** Compact result for agents (and voice): enough to say what was built and where it lives. */
export function toolResult(r: BuildResult) {
  return {
    agent: r.manifest.name,
    url: r.url,
    summary: r.summary,
    mission: r.manifest.mission,
    boards: r.manifest.boards.map((b) => ({ title: b.title, kind: b.kind, url: `${SITE_URL}/s/${b.slug}` })),
    routines: r.manifest.routines.map((x) => ({ title: x.title, when: describeSchedule(x.schedule), runs: x.mode === 'automation' ? 'automatically' : 'by agents, from the playbook' })),
    playbook_note: r.manifest.playbook,
    questions: r.manifest.questions,
  };
}

