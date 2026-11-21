import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/env';

/** Exact-path rules: a bare prefix like /share or /mcp would also block /shared-memory-for-ai-agents and /mcp-server-for-notes-and-tasks. */
const PRIVATE = ['/api', '/auth', '/oauth', '/mcp', '/share', '/p', '/s', '/home', '/spaces', '/boards', '/reminders', '/agents', '/activity', '/settings', '/profile', '/admin', '/notes', '/inbox', '/ask', '/join','/pair', '/offline'];

/** Public marketing pages are crawlable; the signed-in app, auth and API are not. AI crawlers are welcome on public pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/llms.txt'],
        disallow: PRIVATE.flatMap((p) => [`${p}$`, `${p}/`]),
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
