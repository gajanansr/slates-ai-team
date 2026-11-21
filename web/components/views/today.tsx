import Link from 'next/link';
import { AlarmClock, Bot, ChevronRight, Inbox, Phone, Sparkles, TriangleAlert, Users } from 'lucide-react';
import { plainText } from '@/lib/inline';
import { SinceYouLooked, type SinceRow } from '@/components/since-you-looked';
import { ConnectCard } from '@/components/connect-card';
import { GettingStarted } from '@/components/getting-started';
import type { Changes } from '@/lib/history';
import { TodayList } from '@/components/reminders/today-list';
import { dayKey, type Reminder } from '@/lib/reminders';
import { agenda } from '@/lib/agenda';
import { PageTransition } from '@/components/page-transition';
import { StickyHeader } from '@/components/sticky-header';
import { Greeting, TodayDate } from '@/components/greeting';
import { Avatar } from '@/components/avatar';
import type { Profile } from '@/lib/profile';
import type { BriefData, Slate } from '@/lib/kinds';
import type { Activity } from '@/lib/slates';
import { NeedsYou, type DeskRow } from '@/components/desk/needs-you';

export type AutoRun = { id: string; title: string; kind: string; last_run_at: string | null; last_status: string | null };

/**
 * Today is generated, never arranged: what needs you, what changed (and who changed it),
 * and what is coming up. It replaces Home, Inbox, Reminders and Activity as places to check.
 */
export function TodayView({
  all,
  activity = [],
  profile,
  todays = [],
  open = [],
  tz = 'Asia/Kolkata',
  inboxCount = 0,
  changes,
  autos = [],
  hasAgent = false,
  desk = [],
  now = new Date(),
}: {
  all: Slate[];
  activity?: Activity[];
  profile?: Profile;
  todays?: Reminder[];
  /** Every open reminder, for "Coming up". */
  open?: Reminder[];
  tz?: string;
  inboxCount?: number;
  changes?: Changes;
  autos?: AutoRun[];
  hasAgent?: boolean;
  /** Questions and approvals from agents that wait for an answer. */
  desk?: DeskRow[];
  now?: Date;
}) {
  const visible = all.filter((s) => !s.hidden);
  const brief = visible.find((s) => s.kind === 'brief');
  const briefData = brief?.data as BriefData | undefined;
  const openCount = (briefData?.items.filter((i) => !i.done).length ?? 0) + todays.length;
  const failed = autos.filter((a) => a.last_status === 'error');
  const today = dayKey(now, tz);
  const coming = agenda(visible, open, tz, now)
    .filter((d) => d.day > today)
    .flatMap((d) => d.items.map((it) => ({ ...it, label: dayLabel(d.day, today) })))
    .slice(0, 3);
  const last = activity[0];
  const needsCount = desk.length + (inboxCount > 0 ? 1 : 0) + failed.length;

  return (
    <PageTransition>
      <StickyHeader className="mb-3">
        <header className="rise flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="rise text-[24px] font-medium leading-[1.15] tracking-[-0.04em] md:text-[34px]">
              <Greeting />.
            </h1>
            <p className="rise mt-0.5 text-[13.5px] text-fg-3">
              <TodayDate />
            </p>
          </div>
          <Link href="/profile" aria-label="Your profile and settings" className="flex-none rounded-full transition-transform active:scale-95 md:hidden">
            <Avatar style={profile?.avatar} name={profile?.name} email={profile?.email} className="size-10" />
          </Link>
        </header>
      </StickyHeader>

      {!hasAgent && <ConnectCard />}

      <TeamCard working={all.some((x) => x.slug === 'agents-at-work')} />

      {needsCount > 0 && (
        <section className="rise-2 mb-5" aria-labelledby="needs-h">
          <h2 id="needs-h" className="mb-2 flex items-center gap-2 px-0.5 text-[19px] font-medium tracking-[-0.035em]">
            Needs you
            <span className="rounded-full bg-new/15 px-2 py-0.5 text-[12px] font-semibold tracking-normal text-new">{needsCount}</span>
          </h2>
          <NeedsYou rows={desk} />
          {(inboxCount > 0 || failed.length > 0) && (
            <ul className={`card divide-y divide-line ${desk.length ? 'mt-2' : ''}`}>
              {inboxCount > 0 && <Row href="/inbox" icon={<Inbox className="size-4" strokeWidth={1.8} />} title={`${inboxCount} capture${inboxCount === 1 ? '' : 's'} to sort`} sub="Things you saved for later" />}
              {failed.map((a) => (
                <Row key={a.id} href="/settings/automations" icon={<TriangleAlert className="size-4" strokeWidth={1.8} />} title={`${a.title} didn't run`} sub="Automation · tap to see why" />
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="hero rise-2 relative mb-6 overflow-hidden p-4" aria-label="Today">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[13px] text-on-hero-2">Today</span>
          {briefData?.date && <span className="h-7 truncate rounded-full border border-line px-2.5 text-[11.5px] leading-[26px] text-on-hero-2">{briefData.date}</span>}
        </div>
        <p className="mb-1 line-clamp-2 text-[19px] font-medium leading-[1.25] tracking-[-0.025em]">
          {plainText(briefData?.headline ?? '') || (openCount ? `${openCount} thing${openCount === 1 ? '' : 's'} today` : 'Nothing due today')}
        </p>
        <div className="-mx-1 px-1">
          <TodayList brief={brief} todays={todays} tz={tz} max={5} moreHref={brief && todays.length === 0 ? `/s/${brief.slug}` : '/reminders'} />
        </div>
      </section>

      <div className="mb-6">
        <GettingStarted done={{ agent: hasAgent, board: all.some((x) => !['brief', 'notes'].includes(x.kind) && x.slug !== 'inbox' && x.slug !== 'desk'), automation: autos.length > 0 }}>
          <SinceYouLooked
            rows={sinceRows(all, changes, autos)}
            last={last ? { who: last.agent_name ?? (last.agent_id ? 'An agent' : 'You'), what: `${last.action === 'note' ? 'noted' : last.action.replace('_', ' ')}${last.slate_slug ? ` ${all.find((x) => x.slug === last.slate_slug)?.title ?? 'a board'}` : ''}`, at: last.created_at } : null}
          />
        </GettingStarted>
      </div>

      {coming.length > 0 && (
        <section className="rise-3 mb-2" aria-labelledby="coming-h">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <h2 id="coming-h" className="text-[19px] font-medium tracking-[-0.035em]">Coming up</h2>
            <Link href="/reminders" className="py-2 text-[14px] font-medium text-fg-2">Reminders</Link>
          </div>
          <ul className="card divide-y divide-line">
            {coming.map((it) => (
              <Row key={it.key} href={it.href} icon={<AlarmClock className="size-4" strokeWidth={1.8} />} title={it.title} sub={`${it.label}${it.time ? ` · ${it.time}` : ''} · ${it.where}`} />
            ))}
          </ul>
        </section>
      )}
    </PageTransition>
  );
}

function Row({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <li>
      <Link href={href} transitionTypes={['nav-forward']} className="flex items-center gap-3 px-3.5 py-2.5 active:bg-muted">
        <span className="grid size-9 flex-none place-items-center rounded-xl bg-muted text-fg-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium">{title}</span>
          <span className="block truncate text-[12px] text-fg-3">{sub}</span>
        </span>
        <ChevronRight className="size-4 flex-none text-fg-4" />
      </Link>
    </li>
  );
}

/** "Tomorrow", then the weekday and date. Days are YYYY-MM-DD keys in the user's timezone. */
function dayLabel(day: string, today: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
  if (diff === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

/** What changed since you last looked, newest first; the client hides rows you already opened. */
export function sinceRows(all: Slate[], changes: Changes | undefined, autos: AutoRun[]): SinceRow[] {
  const since = changes?.since ? new Date(changes.since).getTime() : 0;
  return [
    ...(changes?.boards ?? []).filter((b) => b.slug !== 'desk').map((b) => {
      const s = all.find((x) => x.slug === b.slug);
      return {
        key: `b-${b.slug}`,
        href: `/s/${b.slug}`,
        icon: { name: s?.icon ?? null, kind: s?.kind ?? ('list' as const) },
        title: b.title,
        sub: `${b.by.slice(0, 2).join(', ') || 'Someone'} · ${b.changes} change${b.changes === 1 ? '' : 's'}`,
        at: b.last_at,
      };
    }),
    ...autos
      .filter((a) => a.last_run_at && new Date(a.last_run_at).getTime() > since && a.last_status !== 'skipped' && a.last_status !== 'error')
      .map((a) => ({ key: `a-${a.id}`, href: '/settings/automations', icon: 'auto' as const, title: a.title, sub: 'Automation ran', at: a.last_run_at! })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/** Your AI team, one tap away: talk to Slates, run a standup with every agent, see who is working on what. */
function TeamCard({ working }: { working: boolean }) {
  return (
    <section className="rise-2 mb-5" aria-labelledby="team-h">
      <h2 id="team-h" className="mb-2 px-0.5 text-[19px] font-medium tracking-[-0.035em]">Your AI team</h2>
      <div className="card p-3.5">
        <p className="mb-3 text-[13.5px] text-fg-3">Talk to Slates, hear what every agent did, or have Slates build a new agent for anything you want handled.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Link href="/call" className="btn btn-primary justify-center">
            <Phone className="size-4" strokeWidth={1.9} /> Call Slates
          </Link>
          <Link href="/call?mode=standup" className="btn btn-glass justify-center">
            <Users className="size-4" strokeWidth={1.9} /> Standup
          </Link>
          <Link href="/agents/studio" className="btn btn-glass justify-center">
            <Sparkles className="size-4" strokeWidth={1.9} /> New agent
          </Link>
        </div>
        {working && (
          <Link href="/s/agents-at-work" className="mt-2 flex items-center justify-between rounded-xl px-1 py-1.5 text-[13.5px] text-fg-2 active:bg-muted">
            <span className="flex items-center gap-2"><Bot className="size-4" strokeWidth={1.8} /> Agents at work</span>
            <span className="text-fg-3">Open</span>
          </Link>
        )}
      </div>
    </section>
  );
}
