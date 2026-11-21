import Link from 'next/link';
import { Chart } from '@/components/charts/chart';
import { NavBar } from '@/components/slate/nav-bar';
import { PageTransition } from '@/components/page-transition';
import { MemberAccess } from '@/components/admin/member-access';
import { InviteCodes, type InviteCode } from '@/components/admin/invite-codes';
import { LinkPending } from '@/components/ui/link-pending';
import { WaitlistAdmin, type WaitlistEntry } from '@/components/admin/waitlist-admin';
import { fitNumber } from '@/lib/fit-number';

type Stats = {
  days: number;
  daily: { day: string; visitors: number; views: number; users: number }[];
  totals: { views: number; visitors: number; users: number; new_users: number; dau: number; wau: number; mau: number; installed_share: number | null };
  top_paths: { path: string; views: number }[];
  referrers: { referrer: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  countries: { country: string; visitors: number }[];
  signups_weekly: { week: string; users: number }[];
  agents: { active: number; by_kind: { kind: string; agents: number }[]; writes: number };
  content: { slates: number; by_kind: { kind: string; slates: number }[]; reminders_open: number; reminders_fired: number; notifications: number; push_devices: number };
  invites: { sent: number; accepted: number; pending: number; inviters: number };
};
export type AdminUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  role: string;
  can_invite: boolean;
  invite_quota: number;
  invited_by: string | null;
  invites_used: number;
  slates: number;
  agents: number;
  reminders_open: number;
  push_devices: number;
  last_seen: string | null;
};

const n = (v: number | null | undefined) => new Intl.NumberFormat('en', { notation: (v ?? 0) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(v ?? 0);
const day = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' }) : 'never');
const region = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="truncate text-[12.5px] text-fg-3">{label}</p>
      <p className="tabular mt-1 whitespace-nowrap font-medium leading-tight tracking-[-0.04em]" style={{ fontSize: fitNumber(value, 26) }}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-fg-3">{sub}</p>}
    </div>
  );
}

/** Ranked list with a meter bar per row (fill = share of the top value). */
function Ranked({ title, rows, empty }: { title: string; rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card p-4">
      <h3 className="mb-3 text-[15px] font-medium tracking-tight">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-3">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className="min-w-0 truncate text-fg-2">{r.label}</span>
                <span className="tabular-nums text-fg">{n(r.value)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-fg" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type AdminTab = 'overview' | 'people' | 'waitlist';
const TABS: { id: AdminTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'waitlist', label: 'Waitlist' },
];

/** Each tab loads only its own data, so the slow analytics query runs on Overview only. */
export function AdminDashboard({ days, stats: s, users = [], codes = [], waitlist = [], tab = 'overview' }: { days: number; stats?: Stats | null; users?: AdminUser[]; codes?: InviteCode[]; waitlist?: WaitlistEntry[]; tab?: AdminTab }) {
  const range = [7, 30, 90];
  const waiting = waitlist.filter((w) => w.status === 'waiting').length; // the badge counts people to act on, not everyone who ever joined
  return (
    <PageTransition>
      <NavBar title="Admin" backHref="/profile" backLabel="Back to profile">
        <header className="mb-4">
          <p className="kicker mb-2">Slates · last {days} days</p>
          <h1 className="text-[32px] font-medium leading-[1.1] tracking-[-0.045em]">How Slates is doing.</h1>
        </header>
      </NavBar>

      <nav aria-label="Admin sections" className="mb-5 grid grid-cols-3 gap-1 rounded-[18px] bg-muted p-1">
        {TABS.map((x) => (
          <Link
            key={x.id}
            href={`/admin?tab=${x.id}&d=${days}`}
            replace
            scroll={false}
            aria-current={tab === x.id ? 'page' : undefined}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-[14px] text-[14px] font-medium ${tab === x.id ? 'bg-surface text-fg shadow-[var(--shadow-card)]' : 'text-fg-3'}`}
          >
            {x.label}
            {x.id === 'waitlist' && waiting > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-on-accent" aria-label={`${waiting} waiting`}>{waiting}</span>}
            <LinkPending />
          </Link>
        ))}
      </nav>

      {tab === 'overview' && s && (
        <>
      <div role="radiogroup" aria-label="Range" className="mb-5 grid grid-cols-3 gap-1 rounded-[18px] bg-muted p-1">
        {range.map((d) => (
          <Link
            key={d}
            href={`/admin?tab=overview&d=${d}`}
            replace
            scroll={false}
            role="radio"
            aria-checked={days === d}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-[14px] text-[14px] font-medium ${days === d ? 'bg-surface text-fg shadow-[var(--shadow-card)]' : 'text-fg-3'}`}
          >
            {d} days
            <LinkPending />
          </Link>
        ))}
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Tile label="Visitors" value={n(s.totals.visitors)} sub={`${n(s.totals.views)} page views`} />
          <Tile label="Users" value={n(s.totals.users)} sub={`+${n(s.totals.new_users)} new`} />
          <Tile label="Active this week" value={n(s.totals.wau)} sub={`${n(s.totals.dau)} today · ${n(s.totals.mau)} this month`} />
          <Tile label="Agents connected" value={n(s.agents.active)} sub={`${n(s.agents.writes)} agent writes`} />
          <Tile label="Installed app" value={s.totals.installed_share === null ? '–' : `${s.totals.installed_share}%`} sub="of page views" />
          <Tile label="Invites" value={`${n(s.invites.accepted)}/${n(s.invites.sent)}`} sub={`joined · ${n(s.invites.inviters)} can invite`} />
        </div>

        <section className="card p-4">
          <h3 className="mb-3 text-[15px] font-medium tracking-tight">Visitors per day</h3>
          <Chart
            mode="full"
            data={{
              type: 'line',
              labels: s.daily.map((d) => day(d.day)),
              series: [
                { id: 'v', name: 'Visitors', values: s.daily.map((d) => d.visitors) },
                { id: 'u', name: 'Signed in', values: s.daily.map((d) => d.users) },
              ],
            }}
          />
        </section>

        <section className="card p-4">
          <h3 className="mb-3 text-[15px] font-medium tracking-tight">New users per week</h3>
          <Chart
            mode="full"
            data={{ type: 'bar', labels: s.signups_weekly.map((w) => w.week), series: [{ id: 'n', name: 'New users', values: s.signups_weekly.map((w) => w.users) }] }}
          />
        </section>

        <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
          <Ranked title="Top pages" rows={s.top_paths.map((p) => ({ label: p.path, value: p.views }))} empty="No views yet." />
          <Ranked title="Referrers" rows={s.referrers.map((r) => ({ label: r.referrer, value: r.visitors }))} empty="Direct traffic only so far." />
          <Ranked title="Countries" rows={s.countries.map((c) => ({ label: region(c.country), value: c.visitors }))} empty="No country data yet." />
          <section className="card p-4">
            <h3 className="mb-3 text-[15px] font-medium tracking-tight">Devices</h3>
            {s.devices.length ? (
              <Chart
                mode="card"
                data={{ type: 'parts', labels: s.devices.slice(0, 5).map((d) => d.device), series: [{ id: 'd', name: 'Visitors', values: s.devices.slice(0, 5).map((d) => d.visitors) }] }}
              />
            ) : (
              <p className="text-sm text-fg-3">No visits yet.</p>
            )}
          </section>
          <Ranked title="Agents by type" rows={s.agents.by_kind.map((a) => ({ label: a.kind, value: a.agents }))} empty="No agents connected." />
          <Ranked title="Boards by type" rows={s.content.by_kind.map((k) => ({ label: k.kind, value: k.slates }))} empty="No boards yet." />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 [&>*]:min-w-0">
          <Tile label="Boards" value={n(s.content.slates)} />
          <Tile label="Open reminders" value={n(s.content.reminders_open)} sub={`${n(s.content.reminders_fired)} fired`} />
          <Tile label="Agent pushes" value={n(s.content.notifications)} />
          <Tile label="Push devices" value={n(s.content.push_devices)} />
        </div>

        </div>
        </>
      )}

      {tab === 'waitlist' && (
        <div className="space-y-6">
          <WaitlistAdmin list={waitlist} />
        </div>
      )}

      {tab === 'people' && (
      <div className="space-y-6">
        <InviteCodes codes={codes} />

        <section>
          <h2 className="mb-2 px-1 text-[20px] font-medium tracking-[-0.03em]">People</h2>
          <ul className="space-y-3">
            {users.map((u) => (
              <li key={u.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{u.email}</p>
                    <p className="mt-0.5 text-[12.5px] text-fg-3">
                      Joined {when(u.created_at)} · last seen {when(u.last_seen ?? u.last_sign_in_at)}
                      {u.invited_by ? ` · invited by ${u.invited_by}` : ''}
                    </p>
                  </div>
                  {u.role === 'admin' ? <span className="pill">Admin</span> : !u.last_sign_in_at ? <span className="pill">Invited</span> : null}
                </div>
                <p className="mt-2 text-[12.5px] text-fg-2">
                  {u.slates} boards · {u.agents} agents · {u.reminders_open} reminders · {u.push_devices} devices
                </p>
                {u.role !== 'admin' && <MemberAccess userId={u.id} canInvite={u.can_invite} quota={u.invite_quota} used={u.invites_used} />}
              </li>
            ))}
          </ul>
        </section>
      </div>
      )}

      <p className="px-1 pb-4 pt-6 text-xs text-fg-4">
        Analytics are first-party: a random visitor id, no IP addresses, private page names collapsed. Do Not Track is respected.
      </p>
    </PageTransition>
  );
}
