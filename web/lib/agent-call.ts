import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTES_SLUG, type Slate } from '@/lib/kinds';
import { DESK_SLUG } from '@/lib/desk';
import { notes } from '@/lib/notes';
import { slates, SlatesError } from '@/lib/slates';
import { getAgent, type AgentManifest } from '@/lib/studio/build';
import { voiceOf } from '@/lib/voices';
import type { CallPersona } from '@/lib/call';

/**
 * Talk to an agent: /call?agent=<slug> puts an Agent Studio agent on the line as the host, in
 * its own Murf voice, with its mission and playbook as its system prompt. Its per-call Slates
 * token is limited to its own boards, plus the Notes board (its playbook and notes live there)
 * and the Desk (hand_off writes there), so it can read and change nothing else.
 */

/** What an agent may do on a call: its boards, notes, reminders, handing off and notifying. Never build_agent. */
export const AGENT_CALL_TOOLS = [
  'list_slates',
  'get_slate',
  'patch_items',
  'find_notes',
  'get_note',
  'add_note',
  'update_note',
  'remind',
  'list_reminders',
  'complete_reminder',
  'hand_off',
  'notify',
  'recent_activity',
] as const;

/** Shared boards an agent's call token also needs: notes (add_note/update_note) and the desk (hand_off). */
export const AGENT_CALL_SHARED = [NOTES_SLUG, DESK_SLUG] as const;

/** Shown in the call UI instead of Slates. */
export type CallAgent = { slug: string; name: string; icon: string; color: string };
export type AgentPersona = CallPersona & { agent: CallAgent };

const PLAYBOOK_MAX = 2500;
const firstOf = (name: string | null | undefined) => name?.trim().split(/\s+/)[0]?.slice(0, 40) || '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One spoken line on where things stand, from the first board that has something open. Null when nothing is worth saying. */
export function boardStatus(boards: Pick<Slate, 'title' | 'kind' | 'data'>[]): string | null {
  for (const b of boards) {
    const d = (b.data ?? {}) as Record<string, any>;
    if (b.kind === 'list' && Array.isArray(d.items) && d.items.length) {
      const open = d.items.filter((i: any) => !i?.done).length;
      if (open) return `${open} of ${plural(d.items.length, 'task')} left on ${b.title}`;
    }
    if (b.kind === 'tracker' && Array.isArray(d.items) && Array.isArray(d.stages) && d.stages.length) {
      const last = d.stages.at(-1)?.id;
      const open = d.items.filter((i: any) => i?.stage !== last).length;
      if (open) return `${plural(open, 'item')} in progress on ${b.title}`;
    }
  }
  return null;
}

/** "Hi Gajanan, it's your Dairy Manager. 3 of 5 tasks left on Daily Routine. What do you need?" */
export function personaGreeting(name: string, firstName: string | null | undefined, status?: string | null) {
  const first = firstOf(firstName);
  return `Hi${first ? ` ${first}` : ''}, it's your ${name}.${status ? ` ${status}.` : ''} What do you need?`;
}

export function personaSystem(m: Pick<AgentManifest, 'name' | 'mission' | 'boards' | 'playbook'>, playbook?: string | null) {
  const boards = m.boards.map((b) => `- ${b.title} (slug "${b.slug}", ${b.kind})${b.purpose ? `: ${b.purpose}` : ''}`).join('\n');
  const how = playbook?.trim() ? `\nYour playbook (note "${m.playbook}"), how you work:\n${playbook.trim().slice(0, PLAYBOOK_MAX)}\n` : '';
  return [
    `You are ${m.name}, one of the user's own agents in Slates, on a voice call with them. Speak as ${m.name}, in the first person; you are not Slates.`,
    `Your job: ${m.mission}`,
    `Your boards (you can read and change only these):\n${boards}`,
    how,
    'Read a board with get_slate before talking about it, and change it with patch_items. Your notes: find_notes, get_note, add_note, update_note. Reminders: list_reminders first (it gives the time and timezone), then remind.',
    'Use notify only for something that needs the user right now. Hand anything outside your boards (web research, code, other areas of their life) to their other agents with hand_off.',
    'Do what they ask, then say in one short sentence what you did. Confirm before removing anything.',
    'Reply in one or two short spoken sentences. No lists, markdown, symbols or emoji.',
    'Never invent board contents: read them with your tools first.',
    'When they are done, say Goodbye.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pure: a manifest (+ its live boards and playbook text) -> the call's host. */
export function personaFor(m: AgentManifest, ctx: { firstName: string | null; playbook?: string | null; live?: Slate[]; timezone?: string }): AgentPersona {
  const voice = voiceOf(m.voice, ctx.timezone);
  const live = new Map((ctx.live ?? []).map((s) => [s.slug, s]));
  const mine = m.boards.map((b) => live.get(b.slug)).filter((s): s is Slate => !!s && !s.archived_at);
  const boards = [...new Set([...m.boards.map((b) => b.slug), ...AGENT_CALL_SHARED])].slice(0, 100);
  return {
    name: m.name,
    voiceId: voice.id,
    locale: voice.locale,
    system: personaSystem(m, ctx.playbook),
    greeting: personaGreeting(m.name, ctx.firstName, boardStatus(mine)),
    boards,
    tools: AGENT_CALL_TOOLS,
    agent: { slug: m.slug, name: m.name, icon: m.icon, color: m.color },
  };
}

/** Load an agent with the user's own session (RLS): 404 when it isn't theirs or doesn't exist. */
export async function loadPersona(sb: SupabaseClient, slug: unknown, firstName: string | null): Promise<AgentPersona> {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new SlatesError('No such agent.', 404, 'not_found');
  const caller = { client: sb, token: null };
  const m = await getAgent(caller, slug);
  if (!m) throw new SlatesError('No such agent.', 404, 'not_found');
  const [live, playbook] = await Promise.all([
    slates.list(caller).catch(() => [] as Slate[]),
    notes
      .get(caller, m.playbook)
      .then((n) => n.body)
      .catch(() => null),
  ]);
  return personaFor(m, { firstName, playbook, live });
}
