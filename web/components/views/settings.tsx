import Link from 'next/link';
import { RowChevron } from '@/components/ui/link-pending';
import { Activity, BookOpen, Bot, EyeOff, SlidersHorizontal, Zap } from 'lucide-react';
import { AppLockRow } from '@/components/app-lock-row';
import type { Slate } from '@/lib/kinds';
import { PageHeader } from '@/components/page-header';
import { ExportRow, ExportNotesRow, InstallRow } from '@/components/settings-client';
import { NotificationsSection, type Prefs } from '@/components/notifications';
import { AppearanceControl } from '@/components/theme';
import { PrivacyRow } from '@/components/privacy';

const DEFAULT_PREFS: Prefs = { on_agent: true, on_brief: true, on_digest: true };

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-2 px-1">{title}</h2>
      {children}
    </section>
  );
}

function Row({ href, icon: Icon, title, sub }: { href: string; icon: typeof Bot; title: string; sub: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5">
      <Icon className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{title}</span>
        <span className="block text-xs text-fg-3">{sub}</span>
      </span>
      <RowChevron />
    </Link>
  );
}

/** Settings: how the app looks and behaves, in groups. Who you are lives in Profile. */
export function SettingsView({ email, all, prefs = DEFAULT_PREFS, agentCount = 0 }: { agentCount?: number; email?: string; all: Slate[]; prefs?: Prefs }) {
  const archived = all.filter((s) => s.archived_at);
  const hidden = all.filter((s) => !s.archived_at && s.hidden);

  return (
    <>
      <PageHeader back={{ href: "/profile", label: "Back to profile" }} kicker="App" title="Settings" />
      <div className="rise-2 space-y-6">
        <Group title="Appearance">
          <div className="space-y-3">
            <AppearanceControl />
            <div className="card">
              <Row href="/settings/customize" icon={SlidersHorizontal} title="Colour" sub="One colour for the whole app" />
            </div>
          </div>
        </Group>

        <Group title="Agents and automation">
          <div className="card divide-y divide-line">
            <Row href="/agents" icon={Bot} title="Agents" sub={agentCount ? `${agentCount} connected` : 'Connect Instinct, Claude, Grok and others'} />
            <Row href="/settings/automations" icon={Zap} title="Automations" sub="Morning brief, weekly recap, inbox filing, RSS" />
            <Row href="/activity" icon={Activity} title="Activity" sub="Everything you and your agents changed" />
          </div>
        </Group>

        <NotificationsSection prefs={prefs} />

        <Group title="Privacy and security">
          <div className="card divide-y divide-line">
            <PrivacyRow />
            <AppLockRow email={email} />
            {(hidden.length > 0 || archived.length > 0) && (
              <Row href="/settings/hidden" icon={EyeOff} title="Hidden & archived" sub={`${hidden.length} hidden · ${archived.length} archived`} />
            )}
          </div>
        </Group>

        <Group title="Data">
          <div className="card divide-y divide-line">
            <InstallRow />
            <ExportRow />
            <ExportNotesRow />
          </div>
        </Group>

        <Group title="Help">
          <div className="card divide-y divide-line">
            <Row href="/guide" icon={BookOpen} title="Guide" sub="Connect any agent and use Slates fully" />
          </div>
        </Group>

        <p className="px-1 text-xs text-fg-4">Slates {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev'}</p>
      </div>
    </>
  );
}
