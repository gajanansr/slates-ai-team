import { notFound } from 'next/navigation';
import { TodayView } from '@/components/views/today';
import { AutomationsView } from '@/components/automations/automations-view';
import { viewMode } from '@/lib/view-mode';
import { EXAMPLES } from '@/lib/kinds';
import { AskChat } from '@/components/ask/ask-chat';
import { BoardsView } from '@/components/views/boards';
import { SlateDetailView } from '@/components/views/slate-detail';
import { AgentsView } from '@/components/views/agents';
import { SettingsView } from '@/components/views/settings';
import { ProfileView } from '@/components/views/profile';
import { ActivityFeed } from '@/components/activity-feed';
import { PageHeader } from '@/components/page-header';
import { Sidebar, TabBar } from '@/components/shell/nav';
import { FIXTURE_ACTIVITY, FIXTURE_ADMIN_STATS, FIXTURE_ADMIN_USERS, FIXTURE_AGENTS, FIXTURE_NOTES, FIXTURE_PROFILE, FIXTURE_REMINDERS, FIXTURE_SLATES } from '../fixtures';
import { NotesView } from '@/components/views/notes';
import { NoteView } from '@/components/views/note';
import { Avatar, AVATARS } from '@/components/avatar';
import { AdminDashboard } from '@/components/admin/admin-dashboard';
import { RemindersView } from '@/components/views/reminders';
import { todaysReminders } from '@/lib/reminders';
import { IllustrationPanel, type IllustrationName } from '@/components/illustrations';
import { StudioView } from '@/components/studio/studio-view';
import { AgentHome } from '@/components/studio/agent-home';
import { STUDIO_AGENTS, studioAgentHome, STUDIO_BUILDING } from '../studio-fixtures';

const ALL_ART: IllustrationName[] = ['stack', 'orbit', 'connect', 'pulse', 'bell', 'sunrise', 'checklist', 'chain', 'target', 'path', 'grid', 'page', 'cloud', 'compass', 'shield'];

/**
 * Dev-only visual harness: every signed-in screen rendered with generic sample data,
 * so layouts can be checked at phone widths without a session. 404 in production.
 */
export default async function Preview({ searchParams }: { searchParams: Promise<{ screen?: string; empty?: string; avatar?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { screen = 'home', empty, avatar } = await searchParams;
  const profile = { ...FIXTURE_PROFILE, avatar: (avatar as any) ?? FIXTURE_PROFILE.avatar, name: empty ? null : FIXTURE_PROFILE.name };
  const all = empty ? [] : FIXTURE_SLATES;
  const view = {
    home: (
      <TodayView
        all={all}
        activity={empty ? [] : FIXTURE_ACTIVITY}
        profile={profile}
        todays={empty ? [] : todaysReminders(FIXTURE_REMINDERS, 'Asia/Kolkata')}
        tz="Asia/Kolkata"
        hasAgent={!empty}
        changes={{
          since: new Date(Date.now() - 86_400_000).toISOString(),
          boards: empty ? [] : FIXTURE_SLATES.slice(0, 4).map((x, i) => ({ slug: x.slug, title: x.title, changes: i + 1, last_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), by: ['Instinct'] })),
        }}
      />
    ),
    reminders: <RemindersView list={empty ? [] : FIXTURE_REMINDERS} tz="Asia/Kolkata" />,
    boards: <BoardsView all={all} filter={undefined} view={await viewMode('boards')} />,
    tracker: <SlateDetailView slate={{ ...FIXTURE_SLATES[0], slug: 'gigs', title: 'Freelance gigs', kind: 'tracker', icon: null, data: EXAMPLES.tracker as any }} />,
    slate: <SlateDetailView slate={FIXTURE_SLATES[Number(empty ?? 0)] ?? FIXTURE_SLATES[0]} />,
    table: <SlateDetailView slate={FIXTURE_SLATES[3]} />,
    list: <SlateDetailView slate={FIXTURE_SLATES[2]} />,
    chartbar: <SlateDetailView slate={FIXTURE_SLATES.find((x) => x.slug === 'spend')!} />,
    chartline: <SlateDetailView slate={FIXTURE_SLATES.find((x) => x.slug === 'sleep')!} />,
    chartparts: <SlateDetailView slate={FIXTURE_SLATES.find((x) => x.slug === 'split')!} />,
    money: <SlateDetailView slate={FIXTURE_SLATES.find((x) => x.slug === 'money')!} />,
    dash: <SlateDetailView slate={FIXTURE_SLATES.find((x) => x.slug === 'launch')!} notes={empty ? [] : (FIXTURE_NOTES as any)} />,
    notes: <NotesView items={empty ? [] : (FIXTURE_NOTES as any)} view={await viewMode('notes')} />,
    note: <NoteView note={FIXTURE_NOTES[Number(empty ?? 0)] as any} linkedFrom={[{ slug: 'launch', title: 'Launchreel', icon: null, kind: 'dashboard' }]} />,
    avatars: (
      <div className="grid grid-cols-5 gap-3">
        {[...AVATARS, 'initials' as const].map((a) => (
          <div key={a} className="text-center">
            <Avatar style={a} name="Gajanan Rathod" className="mx-auto size-24" />
            <Avatar style={a} name="Gajanan Rathod" className="mx-auto mt-2 size-11" />
            <p className="mt-1 text-xs text-fg-3">{a}</p>
          </div>
        ))}
      </div>
    ),
    agents: <AgentsView agents={empty ? [] : FIXTURE_AGENTS} />,
    studio: (
      <>
        <PageHeader kicker="Agent Studio" title="New agent" />
        <StudioView ready left={5} agents={empty ? [] : STUDIO_AGENTS} />
      </>
    ),
    'studio-building': (
      <>
        <PageHeader kicker="Agent Studio" title="New agent" />
        <StudioView ready left={5} agents={[]} preview={STUDIO_BUILDING} />
      </>
    ),
    agent: <AgentHome {...studioAgentHome()} />,
    settings: <SettingsView agentCount={3} email="someone.with.a.long.address@example.com" all={[{ ...FIXTURE_SLATES[4], hidden: true }]} />,
    profile: (
      <ProfileView
        profile={profile}
        email="someone.with.a.long.address@example.com"
        provider="google"
        admin={!empty}
        membership={
          empty
            ? { role: 'member', can_invite: false, quota: 5, used: 0, invites: [] }
            : {
                role: 'admin',
                can_invite: true,
                quota: 5,
                used: 2,
                invites: [
                  { id: 'i1', email: 'friend@example.com', status: 'sent', accepted: true, created_at: '' },
                  { id: 'i2', email: 'colleague@example.com', status: 'sent', accepted: false, created_at: '' },
                ],
              }
        }
      />
    ),
    admin: <AdminDashboard days={30} stats={FIXTURE_ADMIN_STATS as any} users={FIXTURE_ADMIN_USERS as any} />,
    art: (
      <div className="grid grid-cols-3 gap-3">
        {ALL_ART.map((n) => (
          <div key={n}>
            <IllustrationPanel name={n} className="h-[120px]" />
            <p className="mt-1 text-center text-xs text-fg-3">{n}</p>
          </div>
        ))}
      </div>
    ),
    ask: (
      <div className="ask-screen">
        <PageHeader back={{ href: '/home', label: 'Back to home' }} title="Ask Slates" />
        <AskChat ready />
      </div>
    ),
    automations: (
      <>
        <PageHeader back={{ href: '/settings', label: 'Back to settings' }} kicker="Setup" title="Automations" sub="Things Slates does on its own, on a schedule." />
        <AutomationsView
          ready={{ ai: true, jev: true, enc: true }}
          items={[
            { id: 'a1', kind: 'brief', title: 'Morning brief', config: {}, every: 'daily', at_hour: 7, at_weekday: null, enabled: true, next_run_at: null, last_run_at: new Date(Date.now() - 3_600_000).toISOString(), last_status: 'ok', last_error: null } as any,
            { id: 'a2', kind: 'rss', title: 'Hacker News', config: { source: 'hn' }, every: 'hourly', at_hour: null, at_weekday: null, enabled: true, next_run_at: null, last_run_at: new Date(Date.now() - 600_000).toISOString(), last_status: 'ok', last_error: null } as any,
            { id: 'a3', kind: 'recap', title: 'Weekly recap', config: {}, every: 'weekly', at_hour: 19, at_weekday: 0, enabled: true, next_run_at: null, last_run_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), last_status: 'ok', last_error: null } as any,
          ]}
        />
      </>
    ),
    activity: (
      <>
        <PageHeader kicker="Live" title="Activity" sub="Everything you and your agents changed." />
        <ActivityFeed items={FIXTURE_ACTIVITY} />
      </>
    ),
  }[screen];
  return (
    <div className="flex min-h-dvh">
      <Sidebar profile={profile} />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(var(--tabbar-h)+40px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))] sm:px-6 md:pb-16 md:pt-10 lg:max-w-5xl">
          {view}
        </main>
      </div>
      <TabBar launcher={{ pins: [], boards: [], notes: [], inbox: 0, due: 0, admin: false }} />
    </div>
  );
}
