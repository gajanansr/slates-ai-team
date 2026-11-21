import Link from 'next/link';
import { RowChevron } from '@/components/ui/link-pending';
import { Bot, Brain, Settings2, ShieldCheck, Zap } from 'lucide-react';
import { openAboutMe } from '@/app/(app)/desk-actions';
import { ProfileCard } from '@/components/profile-card';
import { PageHeader } from '@/components/page-header';
import { SignOutRow } from '@/components/settings-client';
import { InviteSection, type Membership } from '@/components/invite-section';
import type { Profile } from '@/lib/profile';

/** Profile: who you are, your invites and signing out. App settings live in Settings. */
export function ProfileView({ profile, email, provider, membership, admin }: { profile: Profile; email?: string; provider?: string; membership?: Membership; admin: boolean }) {
  return (
    <>
      <PageHeader back={{ href: "/home", label: "Back to Today" }} kicker="Account" title="Profile" />
      <div className="rise-2 space-y-6">
        <ProfileCard profile={profile} />

        <form action={openAboutMe} className="card">
          <button type="submit" className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <Brain className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">About me</span>
              <span className="block text-xs text-fg-3">The memory every agent shares: tell one, they all know</span>
            </span>
          </button>
        </form>

        <section className="card divide-y divide-line">
          <Link href="/agents" className="flex items-center gap-3 px-4 py-3.5">
            <Bot className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">Agents</span>
              <span className="block text-xs text-fg-3">Connect Claude, ChatGPT, Gemini and see what each can touch</span>
            </span>
            <RowChevron />
          </Link>
          <Link href="/settings/automations" className="flex items-center gap-3 px-4 py-3.5">
            <Zap className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">Automations</span>
              <span className="block text-xs text-fg-3">Morning brief, feeds and inbox filing</span>
            </span>
            <RowChevron />
          </Link>
          <Link href="/settings" className="flex items-center gap-3 px-4 py-3.5">
            <Settings2 className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">Settings</span>
              <span className="block text-xs text-fg-3">Theme, notifications and privacy</span>
            </span>
            <RowChevron />
          </Link>
          {admin && (
            <Link href="/admin" className="flex items-center gap-3 px-4 py-3.5">
              <ShieldCheck className="size-[18px] flex-none text-fg-3" strokeWidth={1.6} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">Admin</span>
                <span className="block text-xs text-fg-3">Visitors, people, invites and the waitlist</span>
              </span>
              <RowChevron />
            </Link>
          )}
        </section>

        {membership && <InviteSection m={membership} />}

        <section className="card divide-y divide-line">
          <div className="px-4 py-3.5">
            <p className="kicker mb-1">Signed in as</p>
            <p className="truncate text-[15px]">{email}</p>
            {provider && <p className="mt-0.5 text-xs text-fg-3">with {provider === 'email' ? 'an email code' : provider}</p>}
          </div>
          <SignOutRow />
        </section>
      </div>
    </>
  );
}
