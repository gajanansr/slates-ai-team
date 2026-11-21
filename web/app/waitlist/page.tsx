import Link from 'next/link';
import { IllustrationPanel } from '@/components/illustrations';
import { Logo } from '@/components/logo';
import { WaitlistForm } from '@/components/auth/waitlist-form';

export const metadata = {
  title: 'Join the Slates waitlist',
  description: 'Slates is the shared workspace for you and all your AI agents. It is invite-only and opens to a few people at a time. Join the waitlist.',
  alternates: { canonical: '/waitlist' },
};

export default function Waitlist() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-[calc(24px+var(--safe-bottom))] pt-[calc(24px+var(--safe-top))]">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="size-9" />
        <span className="text-[24px] font-semibold tracking-[-0.055em]">slates</span>
      </div>
      <IllustrationPanel name="orbit" className="mb-6 h-[clamp(96px,14dvh,150px)] [@media(max-height:720px)]:hidden" />
      <p className="kicker mb-2">Invite only</p>
      <h1 className="text-[30px] font-medium leading-tight tracking-[-0.04em]">Get on the list.</h1>
      <p className="mb-6 mt-2 text-[15px] leading-relaxed text-fg-2">Slates opens to a few people at a time. Leave your email and we&apos;ll send your invite when it&apos;s your turn.</p>
      <WaitlistForm />
      <p className="mt-6 text-center text-sm text-fg-3">
        Have a code?{' '}
        <Link href="/join" className="text-fg underline decoration-fg-4 underline-offset-4">
          Join with a code
        </Link>
        {' · '}
        <Link href="/" className="text-fg underline decoration-fg-4 underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
