import 'server-only';

/** Tiny RSS/Atom reader: titles + links of the newest entries. No dependencies. */
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

export function parseFeed(xml: string, max = 20) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  return blocks.slice(0, max).flatMap((b) => {
    const title = decode(b.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link =
      b.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/)?.[1] ?? decode(b.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ?? '') ?? '';
    const date = decode(b.match(/<(pubDate|published|updated)>([\s\S]*?)<\/\1>/)?.[2] ?? '');
    if (!title || !/^https?:\/\//.test(link)) return [];
    return [{ title: title.slice(0, 200), url: link.slice(0, 2048), date }];
  });
}

export { FEED_SOURCES } from '@/lib/feed-sources';
import { FEED_SOURCES } from '@/lib/feed-sources';

/** A short message people can act on (shown on the automation and in the notification). */
export class FeedError extends Error {}

type Item = { title: string; url: string; date: string };

export type HnList = 'top' | 'best' | 'show' | 'ask' | 'new';

/**
 * Hacker News through its official API (works from any server, unlike scraping the site).
 * `minScore` keeps only posts with at least that many points; `max` is how many to keep.
 */
async function fetchHN(list: HnList, max = 20, minScore = 0): Promise<Item[]> {
  const base = 'https://hacker-news.firebaseio.com/v0';
  const ids = (await (await fetch(`${base}/${list}stories.json`, { signal: AbortSignal.timeout(10_000) })).json()) as number[];
  const out: Item[] = [];
  // Look at up to 90 posts, 30 at a time, until enough pass the points filter.
  for (let at = 0; at < Math.min(ids.length, 90) && out.length < max; at += 30) {
    const batch = await Promise.all(
      ids.slice(at, at + 30).map(async (id) => {
        try {
          const it = (await (await fetch(`${base}/item/${id}.json`, { signal: AbortSignal.timeout(10_000) })).json()) as { title?: string; url?: string; time?: number; score?: number; descendants?: number };
          if (!it?.title || (it.score ?? 0) < minScore) return null;
          return {
            title: it.title.slice(0, 200),
            url: it.url ?? `https://news.ycombinator.com/item?id=${id}`,
            date: `${it.score ?? 0} points · ${it.descendants ?? 0} comments`,
          };
        } catch {
          return null;
        }
      }),
    );
    for (const x of batch) if (x && out.length < max) out.push(x);
  }
  if (!out.length) throw new FeedError(minScore ? `No Hacker News posts with ${minScore}+ points right now. Lower the points filter.` : "Couldn't load Hacker News right now. It will try again next run.");
  return out;
}

/** Read an automation's feed: a picked source, or any website / feed URL. */
export async function readSource(config: { source?: string; url?: string; hn_list?: HnList; min_score?: number; max?: number }): Promise<Item[]> {
  const url = String(config.url ?? '');
  const host = /^https?:\/\//.test(url) ? new URL(url).hostname.replace(/^www\./, '') : '';
  const max = Math.min(50, Math.max(5, Number(config.max ?? 20)));
  const minScore = Math.max(0, Number(config.min_score ?? 0));
  // Hacker News (and hnrss, which blocks cloud servers) go through the official API.
  const hn = config.source === 'hn' || config.source === 'hn-show' || host === 'news.ycombinator.com' || host === 'hnrss.org';
  if (hn) {
    const list: HnList = config.hn_list ?? (config.source === 'hn-show' || /show/i.test(url) ? 'show' : 'top');
    return fetchHN(list, max, minScore);
  }
  const preset = FEED_SOURCES.find((f) => f.id === config.source && 'url' in f);
  return (await fetchFeed(preset && 'url' in preset ? preset.url : url)).slice(0, max);
}

const friendlyStatus = (host: string, status: number) =>
  status === 404
    ? `${host} has no feed at that address. Paste the site's main address, or pick a source.`
    : status === 401 || status === 403 || status === 429
      ? `${host} blocked the request. Try another source.`
      : `${host} isn't answering right now (error ${status}). It will try again next run.`;

export async function fetchFeed(url: string, depth = 0): Promise<Item[]> {
  if (!/^https:\/\//.test(url)) throw new FeedError('Use an address starting with https://');
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(host) || host.endsWith('.internal')) throw new FeedError('That address is not allowed.');
  const name = host.replace(/^www\./, '');
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': 'Slates feed reader (+https://www.slates.space)', Accept: 'application/rss+xml, application/atom+xml, text/xml, text/html;q=0.8' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
  } catch {
    throw new FeedError(`Couldn't reach ${name}. It will try again next run.`);
  }
  if (!r.ok) throw new FeedError(friendlyStatus(name, r.status));
  const text = (await r.text()).slice(0, 2_000_000);
  const items = parseFeed(text);
  if (items.length) return items;
  // A website, not a feed: follow the feed it advertises (<link rel="alternate" type="application/rss+xml">).
  if (depth === 0) {
    const tag = text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
    const href = tag?.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) return fetchFeed(new URL(href.replace(/&amp;/g, '&'), url).toString(), 1);
  }
  throw new FeedError(`No posts found at ${name}. Paste the site's main address, or pick a source.`);
}
