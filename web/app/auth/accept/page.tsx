import Link from 'next/link';
import { IllustrationPanel } from '@/components/illustrations';
import { Logo } from '@/components/logo';
import { FreshLink } from '@/components/auth/fresh-link';

export const metadata = { title: 'Accept invite', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Invite landing: verification happens only when the person taps Accept (POST). */
export default async function Accept({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; error?: string }> }) {
  const q = await searchParams;
  const valid = Boolean(q.token_hash) && !q.error;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-[calc(24px+var(--safe-bottom))] pt-[calc(32px+var(--safe-top))]">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="size-9" />
        <span className="text-[24px] font-semibold tracking-[-0.055em]">slates</span>
      </div>
      <IllustrationPanel name={valid ? 'orbit' : 'compass'} className="mb-7 h-[150px]" />
      {valid ? (
        <>
          <h1 className="text-[30px] font-medium leading-tight tracking-[-0.04em]">You&apos;re invited.</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
            Slates is a quiet dashboard your AI agents keep up to date. Your space is private: nobody else can see it.
          </p>
          <form method="post" action="/auth/accept/confirm" className="mt-7">
            <input type="hidden" name="token_hash" value={q.token_hash} />
            <input type="hidden" name="type" value={q.type ?? 'invite'} />
            <button className="btn btn-primary w-full">Accept invite</button>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-[30px] font-medium leading-tight tracking-[-0.04em]">This link has expired.</h1>
          <p className="mb-6 mt-2 text-[15px] leading-relaxed text-fg-2">
            Invite links work once, for an hour. Enter your email and we&apos;ll send a fresh one.
          </p>
          <FreshLink />
          <p className="mt-6 text-center text-sm text-fg-3">
            Have an invite code?{' '}
            <Link href="/join" className="text-fg underline decoration-fg-4 underline-offset-4">
              Join with a code
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
