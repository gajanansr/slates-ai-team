import Link from 'next/link';
import { Logo } from '@/components/logo';
import { PublicBoard } from '@/components/public/public-board';
import { demoBoards } from '@/lib/demo';

export const revalidate = 3600;
export const metadata = {
  title: 'Slates demo: a board your AI agents keep current',
  description: 'See a live Slates demo: lists, habits, metrics and charts that Claude, ChatGPT or any MCP agent keep up to date. Sample data, read only.',
  alternates: { canonical: '/demo' },
};

/** Public demo (BUG-12): made-up boards, rendered by the real components, read only. */
export default function Demo() {
  const steps = [
    ['Connect an agent', 'Claude, ChatGPT, Instinct or any MCP/REST client. One link or one token.'],
    ['Ask it to build something', '"Make me a dashboard for my launch" becomes a board like the one below.'],
    ['It keeps it current', 'Agents update boards, ping you with reminders and write notes. You just look.'],
  ];
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-[calc(24px+var(--safe-top))] sm:px-6 lg:max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-[20px] font-semibold tracking-[-0.05em]">slates</span>
        </Link>
        <Link href="/" className="btn btn-primary h-10 px-4 text-[14px]">
          Sign in
        </Link>
      </div>
      <p className="kicker mb-2">Demo · sample data</p>
      <h1 className="mb-3 text-[34px] font-medium leading-[1.08] tracking-[-0.045em]">One slate your agents keep current.</h1>
      <p className="mb-6 max-w-[52ch] text-[15px] text-fg-2">Everything below is made up. In your own Slates, agents write it, and you can ask Slates itself to change anything by typing or talking.</p>
      <ol className="mb-10 grid gap-2 sm:grid-cols-3">
        {steps.map(([t, d], i) => (
          <li key={t} className="card p-4">
            <p className="tabular mb-1 text-[13px] text-fg-3">{i + 1}</p>
            <p className="text-[15px] font-medium">{t}</p>
            <p className="mt-1 text-[13px] text-fg-3">{d}</p>
          </li>
        ))}
      </ol>
      {demoBoards().map((b) => (
        <PublicBoard key={b.slug} slate={b} />
      ))}
      <p className="mt-10 text-center text-sm text-fg-3">
        Slates is invite-only for now.{' '}
        <Link href="/join" className="text-fg underline underline-offset-4">
          Have a code?
        </Link>
      </p>
    </main>
  );
}
