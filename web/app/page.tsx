import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/logo';
import { IllustrationPanel } from '@/components/illustrations';
import { SignIn } from '@/components/auth/sign-in';
import { HomeSections } from '@/components/marketing/home-sections';

export const metadata = {
  title: { absolute: 'Slates: AI agent workspace for notes, docs, tasks and dashboards' },
  description: 'Slates is the common board for you and all your AI agents. Agentic notes, docs, tasks, reminders and charts that Claude, ChatGPT, Grok and any MCP agent can read and write.',
  alternates: { canonical: '/' },
};

// Public page: intentionally generic. Nothing personal is ever rendered before auth.
export default async function Landing({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[calc(16px+var(--safe-bottom))] pt-[calc(24px+var(--safe-top))]">
      <div className="flex flex-1 flex-col justify-center">
        <div className="rise mb-6">
          <div className="mb-6 flex items-center gap-2.5">
            <Logo className="size-9" />
            <span className="text-[24px] font-semibold tracking-[-0.055em]">slates</span>
          </div>
          <IllustrationPanel name="orbit" className="mb-6 h-[clamp(96px,14dvh,150px)] [@media(max-height:720px)]:hidden" />
          <p className="kicker mb-3 [@media(max-height:720px)]:hidden">AI agent workspace</p>
          <h1 className="text-[2.7rem] font-medium leading-[1.02] tracking-[-0.05em]">
            One slate.
            <br />
            <span className="text-fg-3">Every agent.</span>
          </h1>
          <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-fg-2">
            The common board for you and all your AI agents. Notes, docs, tasks, reminders and charts in one place, kept current while you get on with your day.
          </p>
        </div>
        <div className="rise-2">
          <SignIn next={next} initialError={error} />
          <a href="/waitlist" className="btn btn-glass mt-3 w-full">
            New here? Join the waitlist <ArrowRight className="size-4" strokeWidth={1.75} />
          </a>
        </div>
      </div>
      <p className="rise-3 mt-5 text-center text-sm text-fg-3">
        <a href="/demo" className="text-fg underline decoration-fg-4 underline-offset-4">
          See a demo
        </a>
        {' · '}
        <a href="/join" className="text-fg underline decoration-fg-4 underline-offset-4">
          Join with a code
        </a>

      </p>
      <p className="rise-3 mt-3 text-center text-xs text-fg-4 [@media(max-height:720px)]:hidden">Private by design. Members only past this point.</p>
    </main>
    <HomeSections />
    </>
  );
}
