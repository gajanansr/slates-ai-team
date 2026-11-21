import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/env';
import { SEO_PAGES } from '@/lib/seo';

const UPDATED = new Date('2026-11-06');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: UPDATED, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/waitlist`, lastModified: UPDATED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/guide`, lastModified: UPDATED, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/demo`, lastModified: UPDATED, changeFrequency: 'weekly', priority: 0.8 },
    ...SEO_PAGES.map((p) => ({ url: `${SITE_URL}/${p.slug}`, lastModified: UPDATED, changeFrequency: 'monthly' as const, priority: 0.9 })),
  ];
}
