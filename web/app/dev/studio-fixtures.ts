import { repairBlueprint, nextRun } from '@/lib/studio/blueprint';
import { DAIRY_REPLY } from '@/tests/studio-fixture';
import type { StudioAgent, Build } from '@/components/studio/studio-view';
import type { AgentManifest } from '@/lib/studio/build';
import { voiceLabel, voiceOf, voiceOptions } from '@/lib/voices';

/** Generic Agent Studio sample data for the dev preview (no personal data). */
const bp = repairBlueprint(structuredClone(DAIRY_REPLY)).blueprint;

export const STUDIO_AGENTS: StudioAgent[] = [
  { slug: 'dairy-manager', name: bp.name, icon: bp.icon, color: bp.color, mission: bp.mission, boards: bp.boards.length, routines: bp.routines.length },
  { slug: 'fitness-coach', name: 'Fitness Coach', icon: 'dumbbell', color: 'orange', mission: 'Plans your week of workouts and keeps your goals and habits honest.', boards: 4, routines: 2 },
  { slug: 'launch-captain', name: 'Launch Captain', icon: 'rocket', color: 'violet', mission: 'Runs your side-project launch from first task to launch day.', boards: 3, routines: 3 },
];

export const STUDIO_BUILDING: Build & { busy: boolean } = {
  stage: 'Building Dairy Manager',
  busy: true,
  agent: { name: bp.name, icon: bp.icon, color: bp.color, mission: bp.mission },
  pieces: [
    ...bp.boards.map((b, i) => ({ piece: 'board' as const, title: b.title, status: i < 3 ? 'created' : undefined })),
    ...bp.routines.map((r) => ({ piece: 'routine' as const, title: r.title })),
    ...bp.reminders.map((r) => ({ piece: 'reminder' as const, title: r.text })),
    ...bp.notes.map((n) => ({ piece: 'note' as const, title: n.title })),
  ],
};

export function studioAgentHome() {
  const m: AgentManifest = {
    studio: 1,
    slug: 'dairy-manager',
    name: bp.name,
    icon: bp.icon,
    color: bp.color,
    mission: bp.mission,
    space: bp.space,
    goal: 'manage my dairy business',
    boards: bp.boards.map((b) => ({ slug: `dairy-manager-${b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title: b.title, kind: b.kind, purpose: b.purpose })),
    routines: bp.routines.map((r, i) => ({ ...r, mode: i === 0 ? 'automation' : 'playbook' })),
    reminders: bp.reminders.map((r) => ({ text: r.text, time: r.time, repeat: r.repeat })),
    notes: [{ id: 'dairy-manager-getting-started', title: bp.notes[0].title }],
    playbook: 'agent-dairy-manager',
    questions: bp.questions,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const tz = 'Asia/Kolkata';
  const glance = ['4 tiles', '2 rows', '2 cards', '1 row', '2 items'];
  return {
    m,
    tz,
    boards: m.boards.map((b, i) => ({ slug: b.slug, title: b.title, kind: b.kind, icon: bp.boards[i].icon ?? null, purpose: b.purpose, glance: glance[i] ?? '' })),
    routines: m.routines.map((r) => ({ ...r, next: nextRun(r.schedule, tz).toISOString() })),
    mine: m.reminders.map((r, i) => ({ id: `r${i}`, text: r.text, due_at: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() })),
    sound: {
      voice: { id: voiceOf(m.voice, tz).id, label: voiceLabel(voiceOf(m.voice, tz)) },
      options: voiceOptions(voiceOf(m.voice, tz).id).map((v) => ({ id: v.id, label: voiceLabel(v) })),
      intro: null,
    },
  };
}
