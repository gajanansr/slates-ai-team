import { ld } from '@/lib/seo';

/** Renders one JSON-LD block. Server component; data is built from our own constants. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(data) }} />;
}
