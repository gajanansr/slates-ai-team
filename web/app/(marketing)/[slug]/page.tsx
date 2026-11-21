import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/logo';
import { JsonLd } from '@/components/marketing/json-ld';
import { SEO_PAGES, abs, faqLd, pageBySlug } from '@/lib/seo';

export const dynamicParams = false;
export const revalidate = 86400;

export function generateStaticParams() {
  return SEO_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = pageBySlug((await params).slug);
  if (!page) return {};
  const url = `/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: { type: 'article', url, title: page.title, description: page.description, siteName: 'Slates', images: [{ url: '/og.png?v=1', width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: ['/og.png?v=1'] },
  };
}

export default async function SeoLanding({ params }: { params: Promise<{ slug: string }> }) {
  const page = pageBySlug((await params).slug);
  if (!page) notFound();
  const related = page.related.map(pageBySlug).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': abs(`/${page.slug}`), url: abs(`/${page.slug}`), name: page.title, description: page.description, isPartOf: { '@type': 'WebSite', name: 'Slates', url: abs('/') } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Slates', item: abs('/') },
        { '@type': 'ListItem', position: 2, name: page.kicker, item: abs(`/${page.slug}`) },
      ] },
      faqLd(page.faq),
    ],
  };
  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-20 pt-[calc(24px+var(--safe-top))] sm:px-6">
      <JsonLd data={graph} />
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-[20px] font-semibold tracking-[-0.05em]">slates</span>
        </Link>
        <Link href="/waitlist" className="btn btn-primary h-10 px-4 text-[14px]">
          Join the waitlist
        </Link>
      </header>
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-fg-3">
        <Link href="/" className="underline decoration-fg-4 underline-offset-4">Slates</Link> / {page.kicker}
      </nav>
      <p className="kicker mb-2">{page.kicker}</p>
      <h1 className="text-[34px] font-medium leading-[1.06] tracking-[-0.045em] sm:text-[44px]">{page.h1}</h1>
      <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-fg-2">{page.intro}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/waitlist" className="btn btn-primary">Join the waitlist <ArrowRight className="size-4" strokeWidth={1.75} /></Link>
        <Link href="/demo" className="btn btn-glass">See the demo</Link>
      </div>
      <div className="mt-12 grid gap-4">
        {page.sections.map((s) => (
          <section key={s.h} className="card p-5">
            <h2 className="text-[19px] font-medium tracking-[-0.03em]">{s.h}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{s.p}</p>
          </section>
        ))}
      </div>
      <section className="mt-12" aria-labelledby="faq">
        <h2 id="faq" className="mb-3 text-[24px] font-medium tracking-[-0.04em]">Frequently asked questions</h2>
        <div className="grid gap-2">
          {page.faq.map((f) => (
            <details key={f.q} className="card p-4">
              <summary className="cursor-pointer text-[15px] font-medium">{f.q}</summary>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="mt-12" aria-labelledby="more">
        <h2 id="more" className="mb-3 text-[19px] font-medium tracking-[-0.03em]">More about Slates</h2>
        <ul className="grid gap-1 text-[15px]">
          {related.map((r) => (
            <li key={r.slug}>
              <Link href={`/${r.slug}`} className="underline decoration-fg-4 underline-offset-4">{r.h1.replace(/[.:].*$/, '')}</Link>
            </li>
          ))}
          <li><Link href="/demo" className="underline decoration-fg-4 underline-offset-4">Live demo with sample boards</Link></li>
          <li><Link href="/llms.txt" className="underline decoration-fg-4 underline-offset-4">Guide for AI agents (llms.txt)</Link></li>
        </ul>
      </section>
    </main>
  );
}
