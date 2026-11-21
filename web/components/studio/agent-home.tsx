import Link from 'next/link';
import { ArrowLeft, Bell, ChevronRight, NotebookPen, Pencil, Phone, Repeat } from 'lucide-react';
import { categorySlug } from '@/lib/summary';
import { describeSchedule } from '@/lib/studio/blueprint';
import type { AgentManifest, ManifestRoutine } from '@/lib/studio/build';
import type { SlateKind } from '@/lib/kinds';
import { AgentMark } from '@/components/studio/agent-mark';
import { AgentVoicePanel, type IntroClip, type VoiceChoice } from '@/components/studio/agent-voice';
import { BoardIcon } from '@/components/board-icon';
import { PageTransition } from '@/components/page-transition';

export type HomeBoard = { slug: string; title: string; kind: SlateKind; icon: string | null; purpose?: string; glance: string };
export type HomeRoutine = ManifestRoutine & { next: string | null; paused?: boolean };
export type HomeReminder = { id: string; text: string; due_at: string };
export type HomeSound = { voice: VoiceChoice; options: VoiceChoice[]; intro: IntroClip | null };

const when = (iso: string | Date, tz: string) =>
  new Intl.DateTimeFormat('en', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** An agent's home: who it is, its boards, what it does on its own and when. */
export function AgentHome({ m, boards, routines, mine, tz, sound }: { m: AgentManifest; boards: HomeBoard[]; routines: HomeRoutine[]; mine: HomeReminder[]; tz: string; sound?: HomeSound }) {
  return (
    <PageTransition>
      <div data-agent={m.color} className="space-y-8">
        <Link href="/agents/studio" transitionTypes={['nav-back']} aria-label="Back to Agent Studio" className="-ml-2 -mb-4 grid size-11 place-items-center rounded-full text-fg transition-colors active:bg-muted">
          <ArrowLeft className="size-[21px]" strokeWidth={1.75} />
        </Link>

        <header className="card agent-glow rise relative overflow-hidden p-5 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
            <AgentMark icon={m.icon} size="xl" />
            <div className="min-w-0 flex-1">
              <p className="kicker mb-2 text-[var(--agent)]">Agent</p>
              <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.045em] [overflow-wrap:anywhere] md:text-[40px]">{m.name}</h1>
              <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-fg-2">{m.mission}</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={`/call?agent=${encodeURIComponent(m.slug)}`} className="btn btn-primary h-11">
              <Phone className="size-4" strokeWidth={1.8} /> Talk to it
            </Link>
            <Link href={`/notes/${encodeURIComponent(m.playbook)}`} className="btn btn-glass h-11">
              <Pencil className="size-4" strokeWidth={1.8} /> Edit
            </Link>
            <Link href={`/spaces/${categorySlug(m.space)}`} className="btn btn-ghost h-11">
              Open its space
            </Link>
          </div>
          {sound && <AgentVoicePanel slug={m.slug} name={m.name} voice={sound.voice} options={sound.options} intro={sound.intro} />}
        </header>

        <section className="rise-2" aria-labelledby="agent-boards">
          <h2 id="agent-boards" className="mb-3 px-1 text-[19px] font-medium tracking-[-0.03em]">Boards</h2>
          {boards.length === 0 ? (
            <p className="card px-4 py-5 text-[14px] text-fg-3">Its boards were archived or removed. Ask any agent to rebuild {m.name}, or build it again in Agent Studio.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {boards.map((b, i) => {
                                return (
                  <li key={b.slug} className="enter" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                    <Link href={`/s/${b.slug}`} transitionTypes={['nav-forward']} className="card press flex h-full items-start gap-3.5 p-4">
                      <span className="grid size-10 flex-none place-items-center rounded-2xl bg-[var(--agent-soft)] text-[var(--agent)]">
                        <BoardIcon name={b.icon} kind={b.kind} className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15.5px] font-medium tracking-[-0.015em]">{b.title}</span>
                        {b.purpose && <span className="mt-0.5 block line-clamp-2 text-[13px] leading-snug text-fg-3">{b.purpose}</span>}
                        <span className="mt-2 block truncate text-[12px] text-fg-3">{b.glance}</span>
                      </span>
                      <ChevronRight className="mt-1 size-4 flex-none text-fg-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {routines.length > 0 && (
          <section className="rise-3" aria-labelledby="agent-routines">
            <h2 id="agent-routines" className="mb-3 px-1 text-[19px] font-medium tracking-[-0.03em]">Routines</h2>
            <ul className="card divide-y divide-line">
              {routines.map((r) => (
                <li key={r.title} className="flex gap-3.5 px-4 py-3.5">
                  <Repeat className="mt-0.5 size-[18px] flex-none text-[var(--agent)]" strokeWidth={1.7} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-[15px] font-medium">{r.title}</p>
                      <span className="flex-none rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-3">{r.mode === 'automation' ? 'Automatic' : 'Playbook'}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug text-fg-3">{r.does}</p>
                    <p className="mt-1.5 text-[12px] text-fg-2">
                      {describeSchedule(r.schedule)}
                      {r.next ? <> · next {when(r.next, tz)}</> : r.paused ? ' · paused' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-1 text-[12px] text-fg-4">Automatic routines run on Slates&apos; schedule. Playbook routines are written in its note, so any agent you connect does them at their time.</p>
          </section>
        )}

        {(mine.length > 0 || m.questions.length > 0 || m.notes.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.length > 0 && (
              <section className="card p-4" aria-labelledby="agent-reminders">
                <h2 id="agent-reminders" className="mb-2 flex items-center gap-2 text-[14px] font-medium text-fg-2">
                  <Bell className="size-4 text-[var(--agent)]" strokeWidth={1.8} /> Reminders
                </h2>
                <ul className="space-y-2">
                  {mine.map((r) => (
                    <li key={r.id} className="text-[14px] leading-snug">
                      <span className="block">{r.text}</span>
                      <span className="block text-[12px] text-fg-3">{when(r.due_at, tz)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {m.questions.length > 0 && (
              <section className="card p-4" aria-labelledby="agent-questions">
                <h2 id="agent-questions" className="mb-2 text-[14px] font-medium text-fg-2">Make it yours</h2>
                <ul className="space-y-2 text-[14px] leading-snug">
                  {m.questions.map((q) => (
                    <li key={q} className="flex gap-2">
                      <span aria-hidden className="mt-[7px] size-1.5 flex-none rounded-full bg-[var(--agent)]" />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] text-fg-3">Tell any agent, or tap Edit and answer in its note.</p>
              </section>
            )}
            {m.notes.length > 0 && (
              <section className="card p-4" aria-labelledby="agent-notes">
                <h2 id="agent-notes" className="mb-1 flex items-center gap-2 text-[14px] font-medium text-fg-2">
                  <NotebookPen className="size-4 text-[var(--agent)]" strokeWidth={1.8} /> Notes
                </h2>
                <ul>
                  {[{ id: m.playbook, title: `How your ${m.name} works` }, ...m.notes].map((n) => (
                    <li key={n.id}>
                      <Link href={`/notes/${encodeURIComponent(n.id)}`} className="flex items-center gap-2 py-1.5 text-[14px]">
                        <span className="min-w-0 flex-1 truncate">{n.title}</span>
                        <ChevronRight className="size-4 flex-none text-fg-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
