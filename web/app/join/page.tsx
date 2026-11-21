import Link from 'next/link';
import { IllustrationPanel } from '@/components/illustrations';
import { Logo } from '@/components/logo';
import { JoinForm } from '@/components/auth/join-form';

export const metadata = { title: 'Join Slates', robots: { index: false, follow: false } };

export default async function Join({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-[calc(24px+var(--safe-bottom))] pt-[calc(24px+var(--safe-top))]">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="size-9" />
        <span className="text-[24px] font-semibold tracking-[-0.055em]">slates</span>
      </div>
      <IllustrationPanel name="orbit" className="mb-6 h-[clamp(96px,14dvh,150px)] [@media(max-height:720px)]:hidden" />
      <p className="kicker mb-2">Invite only</p>
      <h1 className="text-[30px] font-medium leading-tight tracking-[-0.04em]">Join with a code.</h1>
      <p className="mb-6 mt-2 text-[15px] leading-relaxed text-fg-2">Enter your invite code and email. We&apos;ll send you a link to set up your private Slates.</p>
      <JoinForm initialCode={(code ?? '').toUpperCase().slice(0, 40)} />
      <p className="mt-6 text-center text-sm text-fg-3">
        Already a member?{' '}
        <Link href="/" className="text-fg underline decoration-fg-4 underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
