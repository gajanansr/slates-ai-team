/** Popular sources people can pick instead of knowing a feed URL. */
export const FEED_SOURCES = [
  { id: 'hn', name: 'Hacker News', hint: 'Top stories' },
  { id: 'bbc', name: 'BBC News', hint: 'Top stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'verge', name: 'The Verge', hint: 'Tech news', url: 'https://www.theverge.com/rss/index.xml' },
  { id: 'techcrunch', name: 'TechCrunch', hint: 'Startups and tech', url: 'https://techcrunch.com/feed/' },
  { id: 'ars', name: 'Ars Technica', hint: 'Science and tech', url: 'https://feeds.arstechnica.com/arstechnica/index' },
] as const;

/** Filters for Hacker News. */
export const HN_LISTS = [
  { value: 'top', label: 'Top stories', hint: 'The front page' },
  { value: 'best', label: 'Best stories', hint: 'Highest voted lately' },
  { value: 'show', label: 'Show HN', hint: 'Things people built' },
  { value: 'ask', label: 'Ask HN', hint: 'Questions and discussion' },
  { value: 'new', label: 'Newest', hint: 'Everything, as it lands' },
] as const;
export const HN_MIN_SCORES = [
  { value: 0, label: 'Any points' },
  { value: 100, label: '100+ points' },
  { value: 250, label: '250+ points' },
  { value: 500, label: '500+ points' },
] as const;
export const FEED_SIZES = [
  { value: 10, label: '10 posts' },
  { value: 20, label: '20 posts' },
  { value: 30, label: '30 posts' },
] as const;
