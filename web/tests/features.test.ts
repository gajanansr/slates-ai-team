import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, fakeClient, mintToken, tokenCaller, userCaller, USER } from './helpers';
import { slates } from '@/lib/slates';
import { EXAMPLES, validateData } from '@/lib/kinds';
import { history, metricTrends, numeric } from '@/lib/history';
import { inbox, captureItem } from '@/lib/inbox';
import { notes } from '@/lib/notes';
import { searchAll } from '@/lib/search';
import { addDays, daysUntil, streak, today } from '@/lib/summary';
import { parseFeed } from '@/lib/rss';
import { agenda } from '@/lib/agenda';
import { TEMPLATES } from '@/lib/templates';

let pg: PGlite;
beforeEach(async () => {
  pg = await freshDb();
});

describe('new kinds', () => {
  it('examples and templates validate', () => {
    for (const k of ['tracker', 'habits', 'goals', 'countdown'] as const) expect(() => validateData(k, EXAMPLES[k])).not.toThrow();
    for (const t of TEMPLATES) expect(() => validateData(t.kind, t.data), t.id).not.toThrow();
  });
  it('tracker items must use a known stage', () => {
    expect(() => validateData('tracker', { stages: [{ id: 'a', name: 'A' }], items: [{ id: 'x', title: 'X', stage: 'zzz' }] })).toThrow(/unknown stage/);
  });
  it('goals reject a zero target; countdown needs a date', () => {
    expect(() => validateData('goals', { items: [{ id: 'g', title: 'G', current: 1, target: 0 }] })).toThrow();
    expect(() => validateData('countdown', { items: [{ id: 'c', title: 'C', date: 'soon' }] })).toThrow();
  });
  it('can be created through the database (enum values exist)', async () => {
    const c = userCaller(pg);
    for (const k of ['tracker', 'habits', 'goals', 'countdown'] as const) {
      const s = await slates.create(c, { title: k, kind: k, data: EXAMPLES[k] });
      expect(s.kind).toBe(k);
    }
  });
});

describe('date helpers', () => {
  it('streak counts back from today (or yesterday)', () => {
    const t = today();
    expect(streak([t, addDays(t, -1), addDays(t, -2)])).toBe(3);
    expect(streak([addDays(t, -1), addDays(t, -2)])).toBe(2);
    expect(streak([addDays(t, -3)])).toBe(0);
    expect(daysUntil(addDays(t, 5))).toBe(5);
  });
});

describe('history', () => {
  it('snapshots changes and restores an old version as a new one', async () => {
    const c = userCaller(pg);
    await slates.create(c, { slug: 'm', title: 'Money', kind: 'metrics', data: { items: [{ id: 'bal', label: 'Balance', value: '₹1,000' }] } });
    await slates.update(c, 'm', { data: { items: [{ id: 'bal', label: 'Balance', value: '₹1,500' }] } });
    await slates.update(c, 'm', { data: { items: [{ id: 'bal', label: 'Balance', value: '₹900' }] } });
    await slates.update(c, 'm', { pinned: true }); // no data change: no snapshot
    const v = await history.versions(c, 'm');
    expect(v.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(v[0].by).toBe('You');

    const restored = await history.restore(c, 'm', 1);
    expect((restored.data as any).items[0].value).toBe('₹1,000');
    expect((await history.versions(c, 'm'))[0].current).toBe(true);
    await expect(history.restore(c, 'm', restored.version)).rejects.toThrow(/already the current/);

    const trends = metricTrends(await history.series(c, 'm'));
    expect(trends.bal).toEqual([1000, 1500, 900, 1000]);
  });

  it('parses money-ish values', () => {
    expect(numeric('₹1,24,500')).toBe(124500);
    expect(numeric('-₹24,500')).toBe(-24500);
    expect(numeric('58%')).toBe(58);
    expect(numeric('3.4k')).toBe(3400);
    expect(numeric('n/a')).toBeNull();
  });

  it('what changed: agent edits since last seen, then seen resets it', async () => {
    const token = await mintToken(pg, 'Instinct');
    const a = tokenCaller(pg, token);
    const me = userCaller(pg);
    await history.seen(me);
    await slates.create(a, { slug: 'x', title: 'X', kind: 'list', data: { items: [] } });
    await slates.patchItems(a, 'x', { upsert: [{ id: '1', text: 'one' }] });
    await slates.create(me, { slug: 'mine', title: 'Mine', kind: 'list', data: { items: [] } }); // own edits don't count
    const ch = await history.changes(me);
    expect(ch.boards).toHaveLength(1);
    expect(ch.boards[0]).toMatchObject({ slug: 'x', changes: 2, by: ['Instinct'] });
    await expect(history.seen(a)).rejects.toThrow();
  });
});

describe('board-scoped tokens', () => {
  it('only touches its boards, cannot create others or reorder', async () => {
    const me = userCaller(pg);
    await slates.create(me, { slug: 'a', title: 'A', kind: 'list', data: { items: [] } });
    await slates.create(me, { slug: 'b', title: 'B', kind: 'list', data: { items: [] } });
    const { data } = await fakeClient(pg, USER).rpc('create_agent', { p_name: 'Scoped', p_kind: 'other', p_scopes: ['read', 'write'], p_days: 30, p_boards: ['a'] });
    const t = tokenCaller(pg, (data as any).token);
    expect((data as any).agent.expires_at).toBeTruthy();
    expect((await slates.list(t)).map((s) => s.slug)).toEqual(['a']);
    await slates.patchItems(t, 'a', { upsert: [{ id: '1', text: 'ok' }] });
    await expect(slates.get(t, 'b')).rejects.toMatchObject({ status: 403 });
    await expect(slates.create(t, { title: 'C', kind: 'list', data: { items: [] } })).rejects.toMatchObject({ status: 403 });
    await expect(slates.reorder(t, ['a', 'b'])).rejects.toMatchObject({ status: 403 });
    await expect(history.versions(t, 'b')).rejects.toMatchObject({ status: 403 });
    expect((await slates.whoami(t)) as any).toMatchObject({ boards: ['a'] });
  });

  it('expired tokens stop working', async () => {
    const { data } = await fakeClient(pg, USER).rpc('create_agent', { p_name: 'Old', p_days: 1 });
    await pg.exec(`update public.agents set expires_at = now() - interval '1 minute' where name = 'Old'`);
    await expect(slates.list(tokenCaller(pg, (data as any).token))).rejects.toMatchObject({ status: 401 });
  });
});

describe('share links', () => {
  it('anyone with the link reads only that board; turning it off kills it', async () => {
    const me = userCaller(pg);
    await slates.create(me, { slug: 'trip', title: 'Trip', kind: 'list', data: { items: [{ id: '1', text: 'Passport' }] } });
    const owner = fakeClient(pg, USER);
    const on = await owner.rpc('share_set', { p_slug: 'trip', p_on: true });
    const token = (on.data as any).share_token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    const anon = fakeClient(pg, null);
    const r = await anon.rpc('shared_slate', { p_token: token });
    expect(r.data).toMatchObject({ title: 'Trip', kind: 'list' });
    expect(JSON.stringify(r.data)).not.toContain(USER);
    expect((await anon.rpc('share_set', { p_slug: 'trip', p_on: false })).error).toBeTruthy();
    await owner.rpc('share_set', { p_slug: 'trip', p_on: false });
    expect((await anon.rpc('shared_slate', { p_token: token })).data).toBeNull();
  });
});

describe('inbox', () => {
  it('captures, files to a board and into notes', async () => {
    const c = userCaller(pg);
    await slates.create(c, { slug: 'reading', title: 'Reading', kind: 'list', data: { items: [] } });
    const a = await inbox.capture(c, { text: 'https://example.com/post', source: 'Shared' });
    expect(a.text).toBe('example.com');
    expect(a.href).toBe('https://example.com/post');
    const b = await inbox.capture(c, { text: 'Idea: a habit tracker for plants' });
    expect((await inbox.list(c)).map((i) => i.id)).toEqual([b.id, a.id]);

    await inbox.file(c, a.id, { slug: 'reading' });
    expect(((await slates.get(c, 'reading')).data as any).items[0]).toMatchObject({ href: 'https://example.com/post' });
    await inbox.file(c, b.id, { note: true, tags: ['ideas'] });
    expect((await notes.find(c, { tag: 'ideas' }))[0].title).toContain('habit tracker');
    expect(await inbox.list(c)).toEqual([]);
    await expect(inbox.file(c, 'nope', { note: true })).rejects.toMatchObject({ status: 404 });
  });
  it('turns share-sheet text into a tidy item', () => {
    expect(captureItem({ text: 'Great read https://a.com/x' })).toMatchObject({ text: 'Great read', href: 'https://a.com/x' });
  });
});

describe('search and agenda', () => {
  it('finds boards, items inside boards and notes', async () => {
    const c = userCaller(pg);
    await slates.create(c, { slug: 'groceries', title: 'Groceries', kind: 'list', data: { items: [{ id: '1', text: 'Oat milk' }] } });
    await notes.add(c, { title: 'Milk tea recipe', body: 'Brew strong' });
    const hits = searchAll('milk', await slates.list(c), await notes.list(c));
    expect(hits.map((h) => h.kind).sort()).toEqual(['item', 'note']);
    expect(searchAll('groc', await slates.list(c))[0]).toMatchObject({ kind: 'board', href: '/s/groceries' });
  });
  it('agenda gathers dated things for the week', async () => {
    const c = userCaller(pg);
    const t = today('Asia/Kolkata');
    await slates.create(c, { slug: 'cd', title: 'Trips', kind: 'countdown', data: { items: [{ id: 'a', title: 'Goa', date: addDays(t, 2) }, { id: 'b', title: 'Far', date: addDays(t, 40) }] } });
    const days = agenda(await slates.list(c), [], 'Asia/Kolkata');
    expect(days.flatMap((d) => d.items.map((i) => i.title))).toEqual(['Goa']);
  });
});

describe('automations (database)', () => {
  it('saves with a next run in the future; cron needs the secret', async () => {
    const owner = fakeClient(pg, USER);
    const r = await owner.rpc('automations_exec', { p_op: 'save', p_args: { kind: 'rss', title: 'Feed', every: 'daily', at_hour: 7, config: { url: 'https://x.com/f' } } });
    expect(r.error).toBeNull();
    expect(new Date((r.data as any).next_run_at).getTime()).toBeGreaterThan(Date.now());
    const list = await owner.rpc('automations_exec', { p_op: 'list', p_args: {} });
    expect(list.data).toHaveLength(1);
    expect((await fakeClient(pg, null).rpc('cron_due_automations', { p_secret: 'wrong' })).error).toBeTruthy();
    expect((await owner.rpc('automations_exec', { p_op: 'save', p_args: { kind: 'bogus', title: 'x', every: 'daily' } })).error).toBeTruthy();
  });
});

describe('rss', () => {
  it('parses RSS and Atom', () => {
    const rss = `<rss><channel><item><title><![CDATA[Hello &amp; welcome]]></title><link>https://a.com/1</link><pubDate>Mon</pubDate></item><item><title>Bad</title><link>javascript:x</link></item></channel></rss>`;
    expect(parseFeed(rss)).toEqual([{ title: 'Hello & welcome', url: 'https://a.com/1', date: 'Mon' }]);
    const atom = `<feed><entry><title>Post</title><link href="https://b.com/p"/><updated>2026</updated></entry></feed>`;
    expect(parseFeed(atom)[0]).toMatchObject({ title: 'Post', url: 'https://b.com/p' });
  });
});

describe('gemini tool schemas', () => {
  it('strips keywords Gemini rejects from every tool', async () => {
    const { geminiSchema } = await import('@/lib/assistant');
    const { TOOLS, toolJsonSchema } = await import('@/lib/agent/tools');
    for (const t of TOOLS) {
      const s = JSON.stringify(geminiSchema(toolJsonSchema(t)));
      expect(s, t.name).not.toMatch(/propertyNames|"pattern"|"additionalProperties":\{\}|"format":"(uri|uuid|email)"/);
    }
  });
});

describe('rss fetch', () => {
  const withFetch = async (fn: (url: string) => Response | Promise<Response>, run: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: any) => fn(String(u))) as any;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it('a page with no posts is a short, friendly error (not an empty board)', async () => {
    const { fetchFeed } = await import('@/lib/rss');
    await withFetch(
      () => new Response('<html><body>Sorry.</body></html>', { status: 200 }),
      () => expect(fetchFeed('https://example.com/rss')).rejects.toThrow('No posts found at example.com. Paste the site'),
    );
    await withFetch(
      () => new Response('nope', { status: 404 }),
      () => expect(fetchFeed('https://hnrss.org/frontpage')).rejects.toThrow('hnrss.org has no feed at that address'),
    );
  });

  it('finds the feed a website advertises', async () => {
    const { fetchFeed } = await import('@/lib/rss');
    await withFetch(
      (u) =>
        u.endsWith('/feed.xml')
          ? new Response('<rss><channel><item><title>Post</title><link>https://site.com/p</link></item></channel></rss>')
          : new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>'),
      async () => expect((await fetchFeed('https://site.com'))[0]).toMatchObject({ title: 'Post', url: 'https://site.com/p' }),
    );
  });

  it('Hacker News (and hnrss addresses) use the official API', async () => {
    const { readSource } = await import('@/lib/rss');
    const seen: string[] = [];
    await withFetch(
      (u) => {
        seen.push(u);
        if (u.endsWith('/topstories.json')) return Response.json([1, 2]);
        if (u.endsWith('/item/1.json')) return Response.json({ title: 'One', url: 'https://a.com/1', time: 1 });
        return Response.json({ title: 'Ask HN: two', time: 2 });
      },
      async () => {
        const items = await readSource({ url: 'https://hnrss.org/frontpage' });
        expect(items.map((i) => i.title)).toEqual(['One', 'Ask HN: two']);
        expect(items[1].url).toBe('https://news.ycombinator.com/item?id=2');
      },
    );
    expect(seen.every((u) => u.startsWith('https://hacker-news.firebaseio.com/'))).toBe(true);
  });

  it('Hacker News filters: list, minimum points, how many', async () => {
    const { readSource } = await import('@/lib/rss');
    const seen: string[] = [];
    await withFetch(
      (u) => {
        seen.push(u);
        if (u.endsWith('/beststories.json')) return Response.json([1, 2, 3, 4]);
        const id = Number(u.match(/item\/(\d+)/)?.[1]);
        return Response.json({ title: `Post ${id}`, url: `https://a.com/${id}`, score: id * 100, descendants: 3 });
      },
      async () => {
        const items = await readSource({ source: 'hn', hn_list: 'best', min_score: 250, max: 5 });
        expect(items.map((i) => i.title)).toEqual(['Post 3', 'Post 4']);
        expect(items[0].date).toBe('300 points · 3 comments');
      },
    );
    expect(seen[0]).toContain('/beststories.json');
  });
});
