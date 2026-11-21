import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { Sidebar, TabBar } from '@/components/shell/nav';
import { LiveRefresh } from '@/components/shell/live-refresh';
import { TimezoneSync } from '@/components/shell/timezone-sync';
import { supabaseServer } from '@/lib/supabase/server';
import { profileOf } from '@/lib/profile';
import { CommandPalette } from '@/components/command';
import { AppLock } from '@/components/app-lock';
import { UndoToast } from '@/components/undo-toast';
import { NavSkeleton } from '@/components/shell/nav-skeleton';
import { askReady } from '@/lib/assistant';
import { PaletteSync } from '@/components/theme';
import { parseLayout, resolvePins } from '@/lib/app-layout';
import { slates } from '@/lib/slates';
import { reminders, todaysReminders } from '@/lib/reminders';
import { notesOf } from '@/lib/notes';
import { isSpaceBoard } from '@/lib/spaces';

export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/');
  const client = await supabaseServer();
  const caller = { client, token: null };
  // The Apps sheet needs every board and note title (for shortcuts and search) and two counts.
  const [{ data: settings }, { data: isAdmin }, all, open] = await Promise.all([
    client.from('user_settings').select('timezone, app_layout').maybeSingle(),
    client.rpc('is_admin'),
    slates.list(caller).catch(() => []),
    reminders.list(caller).catch(() => []),
  ]);
  const layout = parseLayout(settings?.app_layout);
  const tz = settings?.timezone ?? 'Asia/Kolkata';
  const boards = all.filter(isSpaceBoard).map((b) => ({ slug: b.slug, title: b.title, icon: b.icon ?? null, kind: b.kind as string, pinned: b.pinned }));
  const notes = notesOf(all.find((b) => b.kind === 'notes') ?? null).map((n) => ({ id: n.id, title: n.title })).slice(0, 300);
  const launcher = {
    pins: resolvePins(layout, boards, notes),
    boards: boards.map(({ pinned: _p, ...b }) => b),
    notes,
    inbox: ((all.find((b) => b.slug === 'inbox')?.data as { items?: unknown[] } | undefined)?.items ?? []).length,
    due: todaysReminders(open, tz).length,
    admin: !!isAdmin,
  };
  return (
    <div className="flex min-h-dvh">
      <Sidebar profile={profileOf(user)} pins={launcher.pins} />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(var(--tabbar-h)+40px+var(--safe-bottom))] pt-[calc(20px+var(--safe-top))] sm:px-6 md:pb-16 md:pt-10 lg:max-w-5xl">
          {children}
        </main>
      </div>
      <TabBar launcher={launcher} />
      <LiveRefresh userId={user.id} />
      <TimezoneSync current={settings?.timezone ?? null} />
      <CommandPalette canAsk={askReady()} />
      <PaletteSync palette={layout.palette} accent={layout.accent} />
      <NavSkeleton />
      <UndoToast />
      <AppLock />
    </div>
  );
}
