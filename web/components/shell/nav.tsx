'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, AlarmClock, Bot, Grip, Inbox, Layers, NotebookPen, Sparkles, Sun, X } from 'lucide-react';
import { BoardIcon } from '@/components/board-icon';
import { Launcher, type LauncherData } from '@/components/shell/launcher';
import { Logo } from '@/components/logo';
import { Avatar } from '@/components/avatar';
import type { Profile } from '@/lib/profile';

/**
 * The bottom bar is the same for everyone: Today (what needs you, what changed, what is coming
 * up), the Ask bar (type or speak anything), and Apps (every feature, then your own shortcuts).
 */
type Place = 'today' | 'spaces' | 'ask';
const SPACES = /^\/(spaces|boards|s|notes)(\/|$)/;

export function placeOf(path: string): Place | null {
  if (/^\/home(\/|$)/.test(path)) return 'today';
  if (/^\/ask(\/|$)/.test(path)) return 'ask';
  if (SPACES.test(path)) return 'spaces';
  return null;
}

/** Highlight the tapped place at once; hand back to the real route when it lands. */
function usePlace() {
  const path = usePathname();
  const [picked, setPicked] = useState<{ place: Place; from: string } | null>(null);
  useEffect(() => setPicked(null), [path]);
  const current = picked && picked.from === path ? picked.place : placeOf(path);
  return { current, pick: (place: Place) => setPicked({ place, from: path }) };
}

/** Phones: Today on the left, the Ask bar in the middle, and Apps (features and your shortcuts) on the right. */
export function TabBar({ launcher }: { launcher: LauncherData }) {
  const path = usePathname();
  const { current, pick } = usePlace();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const side = 'flex h-full w-[68px] flex-none flex-col items-center justify-center gap-1 rounded-[18px] text-[11px] font-medium transition-colors duration-200 active:scale-95';
  const on = 'bg-tab-active text-on-tab-active';
  const today = current === 'today' && !open;
  const asking = current === 'ask' && !open;
  // Everything that is not Today or Ask is reached through Apps, so Apps lights up there.
  const apps = open || (current !== 'today' && current !== 'ask');
  return (
    <>
      <Launcher data={launcher} open={open} onClose={() => setOpen(false)} />
      {/* A soft fade under the bar, so content never meets it with a hard edge. */}
      <div aria-hidden className="tab-fade pointer-events-none fixed inset-x-0 bottom-0 z-[59] h-[calc(var(--tabbar-h)+var(--safe-bottom)+44px)] md:hidden" style={{ background: 'linear-gradient(to top, var(--page) 38%, color-mix(in srgb, var(--page) 70%, transparent) 62%, transparent)' }} />
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-[calc(10px+var(--safe-bottom))] md:hidden">
        <div className="mx-auto flex h-[var(--tabbar-h)] max-w-sm items-center gap-1.5 rounded-[24px] bg-tab p-1.5 shadow-[var(--shadow-float)]">
          <Link href="/home" prefetch onClick={() => { pick('today'); setOpen(false); }} aria-current={today ? 'page' : undefined} className={`${side} ${today ? on : 'text-fg-3'}`}>
            <Sun className="size-[19px]" strokeWidth={today ? 1.9 : 1.6} />
            Today
          </Link>
          <Link
            href="/ask"
            prefetch
            onClick={() => { pick('ask'); setOpen(false); }}
            aria-current={asking ? 'page' : undefined}
            aria-label="Ask Slates"
            className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded-[18px] px-3.5 text-[14.5px] transition-colors duration-200 active:scale-[0.98] ${asking ? `${on} font-medium` : 'bg-muted text-fg-3'}`}
          >
            <Sparkles className="size-[17px] flex-none" strokeWidth={1.75} />
            <span className="truncate">{asking ? 'Ask Slates' : 'Ask or add anything'}</span>
          </Link>
          <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${side} ${apps ? on : 'text-fg-3'}`}>
            {open ? <X className="size-[19px]" strokeWidth={1.9} /> : <Grip className="size-[19px]" strokeWidth={apps ? 1.9 : 1.7} />}
            Apps
          </button>
        </div>
      </nav>
    </>
  );
}

const MORE = [
  { href: '/notes', label: 'Notes', Icon: NotebookPen, match: /^\/notes/ },
  { href: '/inbox', label: 'Inbox', Icon: Inbox, match: /^\/inbox/ },
  { href: '/reminders', label: 'Reminders', Icon: AlarmClock, match: /^\/reminders/ },
  { href: '/agents', label: 'Agents', Icon: Bot, match: /^\/agents/ },
  { href: '/activity', label: 'Activity', Icon: Activity, match: /^\/activity/ },
];

export function Sidebar({ profile, pins = [] }: { profile: Profile; pins?: LauncherData['pins'] }) {
  const path = usePathname();
  const { current, pick } = usePlace();
  const cls = (active: boolean) =>
    `flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors ${active ? 'bg-tab-active text-on-tab-active' : 'text-fg-3 hover:bg-muted hover:text-fg'}`;
  const main: { place: Place; href: string; label: string; Icon: typeof Sun }[] = [
    { place: 'today', href: '/home', label: 'Today', Icon: Sun },
    { place: 'spaces', href: '/spaces', label: 'Spaces', Icon: Layers },
    { place: 'ask', href: '/ask', label: 'Ask', Icon: Sparkles },
  ];
  // A library page (Notes) lights its own row, not Spaces as well.
  const inMore = MORE.some((m) => m.match.test(path));
  const meActive = /^\/(profile|settings|admin)/.test(path);
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-3 py-6 md:flex">
      <Link href="/home" className="mb-8 flex items-center gap-2.5 px-3">
        <Logo className="size-8" />
        <span className="text-[19px] font-semibold tracking-[-0.04em]">slates</span>
      </Link>
      <ul className="space-y-1">
        {main.map(({ place, href, label, Icon }) => {
          const active = current === place && !inMore;
          return (
            <li key={href}>
              <Link href={href} prefetch onClick={() => pick(place)} aria-current={active ? 'page' : undefined} className={cls(active)}>
                <Icon className="size-[17px]" strokeWidth={1.75} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="kicker mb-1.5 mt-6 px-3">Library</p>
      <ul className="space-y-1">
        {MORE.map(({ href, label, Icon, match }) => (
          <li key={href}>
            <Link href={href} prefetch aria-current={match.test(path) ? 'page' : undefined} className={cls(match.test(path))}>
              <Icon className="size-[17px]" strokeWidth={1.75} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
      {pins.length > 0 && (
        <>
          <p className="kicker mb-1.5 mt-6 px-3">Shortcuts</p>
          <ul className="min-h-0 space-y-1 overflow-y-auto">
            {pins.map((p) => {
              const active = path === p.href;
              return (
                <li key={p.key}>
                  <Link href={p.href} prefetch aria-current={active ? 'page' : undefined} className={cls(active)}>
                    {p.kind === 'notes' ? <NotebookPen className="size-[17px] flex-none" strokeWidth={1.75} /> : <BoardIcon name={p.icon} kind={p.kind as any} className="size-[17px] flex-none" />}
                    <span className="truncate">{p.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Link href="/profile" aria-current={meActive ? 'page' : undefined} className={`mt-auto flex items-center gap-3 rounded-2xl p-2 transition-colors ${meActive ? 'bg-muted' : 'hover:bg-muted'}`}>
        <Avatar style={profile.avatar} name={profile.name} email={profile.email} className="size-9 flex-none" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{profile.name ?? 'You'}</span>
          <span className="block truncate text-xs text-fg-4">{profile.email}</span>
        </span>
      </Link>
    </aside>
  );
}
