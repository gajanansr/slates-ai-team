import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { JsonLd } from '@/components/marketing/json-ld';
import { HOME_FAQ, SEO_PAGES, abs, faqLd, softwareLd } from '@/lib/seo';

const REPLACES = [
  ['To-do app', 'Lists with tick-off, attachments and share links'],
  ['Notes app', 'Markdown notes, tags, quick capture and documents'],
  ['Reminders', 'Push to your phone, repeat, snooze, this-week agenda'],
  ['Habit tracker', 'Daily check-offs, streaks and a calendar'],
  ['Budget spreadsheet', 'Tables, charts, metrics and a monthly budget template'],
  ['Goal and countdown tracker', 'Goals and countdowns on one screen'],
  ['Bookmarks', 'Links, plus feeds you can automate'],
];

/** Crawlable content under the sign-in card: what Slates is, who it works with, FAQ and internal links. */
export function HomeSections() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Slates', url: abs('/'), logo: abs('/icon-512.png') },
      { '@type': 'WebSite', name: 'Slates', url: abs('/') },
      softwareLd(),
      faqLd(HOME_FAQ),
    ],
  };
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-20 pt-10 sm:px-6">
      <JsonLd data={graph} />
      <section aria-labelledby="what">
        <h2 id="what" className="text-[26px] font-medium leading-tight tracking-[-0.04em]">
          The common board for you and all your AI agents.
        </h2>
        <p className="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-fg-2">
          Slates is an AI agent workspace. Claude, ChatGPT, Grok and any MCP or REST agent read and write the same board, so your context lives in one place
          and every assistant starts from what you already know. It replaces seven apps with typed boards: agentic notes and docs, tasks, reminders, habits,
          goals, tables and charts.
        </p>
      </section>

      <section className="mt-10" aria-labelledby="replaces">
        <h2 id="replaces" className="mb-3 text-[20px] font-medium tracking-[-0.03em]">The features of 7 apps in one</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {REPLACES.map(([a, b]) => (
            <li key={a} className="card p-4">
              <p className="text-[15px] font-medium">{a}</p>
              <p className="mt-1 text-[13px] text-fg-3">{b}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="agents">
        <h2 id="agents" className="mb-3 text-[20px] font-medium tracking-[-0.03em]">Every agent connects, and you stay in control</h2>
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-fg-2">
          Connect over MCP or REST, with one-tap connectors for claude.ai and ChatGPT. Each agent has its own token: read-only or read and write, limited to
          certain boards, with an expiry, revocable any time. Every change shows in Activity with the agent&apos;s name, and any version can be restored.
        </p>
      </section>

      <section className="mt-10" aria-labelledby="learn">
        <h2 id="learn" className="mb-3 text-[20px] font-medium tracking-[-0.03em]">Learn more</h2>
        <ul className="grid gap-1 text-[15px]">
          <li><Link href="/guide" className="underline decoration-fg-4 underline-offset-4">Guide: use Slates with Claude, ChatGPT, Gemini and more</Link></li>
          {SEO_PAGES.map((p) => (
            <li key={p.slug}>
              <Link href={`/${p.slug}`} className="underline decoration-fg-4 underline-offset-4">{p.h1.replace(/[.:].*$/, '')}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="faq">
        <h2 id="faq" className="mb-3 text-[20px] font-medium tracking-[-0.03em]">Frequently asked questions</h2>
        <div className="grid gap-2">
          {HOME_FAQ.map((f) => (
            <details key={f.q} className="card p-4">
              <summary className="cursor-pointer text-[15px] font-medium">{f.q}</summary>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="mt-10 flex flex-wrap gap-2">
        <Link href="/waitlist" className="btn btn-primary">Join the waitlist <ArrowRight className="size-4" strokeWidth={1.75} /></Link>
        <Link href="/demo" className="btn btn-glass">See the demo</Link>
      </div>
    </div>
  );
}
