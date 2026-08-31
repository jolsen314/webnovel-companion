import { describe, expect, test } from 'vitest';
import {
  addSeries,
  pollAllSources,
  evaluateSchedules,
  notifyForEffects,
  getNotificationPrefs,
  updateNotificationPrefs,
  listSeries,
  getSeries,
  updateSeries,
  savePushSubscription,
  backfillFromToc,
  backfillWithEscalation,
  reclassifySource,
  setApiDescriptor,
  switchToPageWatch,
  getFeed,
  type FetchImpl,
} from '../../src/server/services';
import { db } from '../../src/server/db';
import { getCurrentUserId } from '../../src/server/user';
import type { PoliteResult } from '../../src/lib/feeds/fetch';
import type { PollEffects } from '../../src/server/services/poll';
import type { PushSendPorts, PushTarget } from '../../src/server/services/pushSend';
import type { PushMessage } from '../../src/lib/notify';

// ── fixtures ────────────────────────────────────────────────────────────────
const okRes = (body: string, extra: Partial<Extract<PoliteResult, { outcome: 'SUCCESS' }>> = {}): PoliteResult => ({
  outcome: 'SUCCESS',
  status: 200,
  notModified: false,
  body,
  etag: null,
  lastModified: null,
  finalUrl: 'https://x.example/',
  ...extra,
});
const PAGE = (feed: string) =>
  `<html><head><link rel="alternate" type="application/rss+xml" href="${feed}"></head><body></body></html>`;
const RSS = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha</title>${items}</channel></rss>`;
const ITEM = (guid: string, url: string) => `<item><title>Chapter ${guid}</title><link>${url}</link><guid>${guid}</guid></item>`;
const fetchFrom =
  (map: Record<string, PoliteResult>): FetchImpl =>
  async (url) =>
    map[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);

/** WP-50: addSeries now returns a `kind`-discriminated union. Every integration test here exercises
 *  the create path, so narrow once at the call site instead of guarding at every read of
 *  `.seriesId`/`.resolved`/`.alreadyExisting`/`.similarTo`. */
async function created<T extends { kind: string }>(p: Promise<T>): Promise<Extract<T, { kind: 'created' }>> {
  const result = await p;
  if (result.kind !== 'created') throw new Error(`expected addSeries to create, got kind=${result.kind}`);
  return result as Extract<T, { kind: 'created' }>;
}

const PAGE_URL = 'https://translator.example/novel/alpha/';
const FEED_URL = 'https://translator.example/feed/';
const C1 = 'https://translator.example/a-1/';
const C2 = 'https://translator.example/a-2/';
const C3 = 'https://translator.example/a-3/';

/** Add the "Alpha" series (page → feed with 2 chapters) and return its id. */
async function addAlpha(): Promise<string> {
  const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
  const { seriesId } = await created(addSeries({ url: PAGE_URL }, fetch));
  return seriesId;
}

// ── tests ───────────────────────────────────────────────────────────────────
describe('addSeries (real DB)', () => {
  test('creates Series + Source + Chapters from a discovered feed', async () => {
    const seriesId = await addAlpha();

    const series = await db.series.findUnique({ where: { id: seriesId }, include: { sources: true, chapters: true } });
    expect(series).not.toBeNull();
    expect(series!.sources).toHaveLength(1);
    expect(series!.sources[0]!.feedUrl).toBe(FEED_URL);
    expect(series!.sources[0]!.host).toBe('translator.example');
    expect(series!.chapters.map((c) => c.guid).sort()).toEqual(['g1', 'g2']);
  });

  test('WP-37: add-time resolves and persists tocUrl from a landing-page TOC link', async () => {
    const LANDING = 'https://toc.example/series/beta/';
    const TOC = 'https://toc.example/series/beta/contents/';
    // Landing page: no feed, links to a separate TOC page.
    const landingBody = `<html><body>
      <a href="/series/beta/contents/">Table of Contents</a>
    </body></html>`;
    const tocBody = `<html><body>
      <a href="/series/beta/chapter-1">Chapter 1</a>
    </body></html>`;
    const fetch = fetchFrom({
      [LANDING]: okRes(landingBody),
      [TOC]: okRes(tocBody),
      // feed guesses 404 → page-watch path
    });
    const { seriesId } = await created(addSeries({ url: LANDING }, fetch));
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.tocUrl).toBe(TOC);
    expect(source.url).toBe(LANDING); // reading url unchanged
  });

  test('WP-33: a feed series seeds its full TOC history at add, with TOC access', async () => {
    // Page advertises the feed AND lists the full chapter history (feed shows only a-1,a-2; TOC adds a-3).
    const PAGE_HTML =
      `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED_URL}"></head>` +
      `<body><ul>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `</ul></body></html>`;
    const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE_HTML), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
    const { seriesId } = await created(addSeries({ url: PAGE_URL }, fetch));

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([C1, C2, C3]); // a-3 backfilled from the TOC
    expect(chapters.find((c) => c.url === C3)!.access).toBe('FREE');
    expect(chapters.find((c) => c.url === C1)!.guid).toBe('g1'); // overlap kept the feed guid
  });

  test('WP-39: re-adding the same series returns the existing one, no second row', async () => {
    const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1))) });
    const first = await created(addSeries({ url: PAGE_URL }, fetch));
    const second = await created(addSeries({ url: PAGE_URL }, fetch));

    expect(first.alreadyExisting).toBe(false);
    expect(second.alreadyExisting).toBe(true);
    expect(second.seriesId).toBe(first.seriesId);
    expect(await db.series.count()).toBe(1);
    expect((await db.series.findFirstOrThrow()).canonicalId).toBe('translator.example/feed#WHOLE_FEED');
  });

  test('WP-30: add adopts the page <h1> over a feed channel title that is the site name', async () => {
    const URL = 'https://titlesite.example/series/omega/';
    const FEED = 'https://titlesite.example/series/omega/feed';
    // Page advertises a per-series feed; the feed channel <title> is the SITE name, but the page <h1> is the real series.
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED}"></head>`
      + `<body><h1>The Omega Chronicle</h1></body></html>`;
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>TitleSite</title>`
      + `<item><title>The Omega Chronicle Chapter 1</title><link>https://titlesite.example/omega-1/</link><guid>o1</guid></item>`
      + `</channel></rss>`;
    const { seriesId } = await created(addSeries({ url: URL }, fetchFrom({ [URL]: okRes(page), [FEED]: okRes(feed) })));
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(series.title).toBe('The Omega Chronicle'); // not "TitleSite"
    expect(series.titleIsManual).toBe(false);
  });

  test('WP-30: page-watch add uses the page <h1> over the URL slug', async () => {
    const URL = 'https://pw2.example/novels/xyz-acronym/';
    const page = `<html><body><h1>Extremely Yielding Zenith</h1>`
      + `<a href="/novels/xyz-acronym/chapter-1">Chapter 1</a></body></html>`;
    const { seriesId } = await created(addSeries({ url: URL }, fetchFrom({ [URL]: okRes(page) })));
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(series.title).toBe('Extremely Yielding Zenith'); // not "Xyz Acronym"
  });

  test('WP-30: a WHOLE_FEED channel title that IS the site name falls back to the URL slug (guard)', async () => {
    const URL = 'https://sitename.example/series/the-real-novel/';
    const FEED = 'https://sitename.example/series/the-real-novel/feed';
    // Landing page advertises the per-series feed but has NO heading → pageTitle is null.
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED}"></head><body></body></html>`;
    // The feed's channel <title> is the SITE name (matches the host via matchesSiteName).
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Sitename</title>`
      + `<item><title>Chapter 1</title><link>https://sitename.example/the-real-novel/c1/</link><guid>g1</guid></item>`
      + `</channel></rss>`;
    const { seriesId } = await created(addSeries({ url: URL }, fetchFrom({ [URL]: okRes(page), [FEED]: okRes(feed) })));
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(series.title).toBe('The Real Novel'); // titleFromUrl slug, NOT "Sitename"
  });

  test('WP-39b: adding a title similar to an existing series returns a similarTo hint (still creates)', async () => {
    // Series 1 — page-watch, title from the <h1>.
    await created(addSeries(
      { url: 'https://one.example/series/alpha/' },
      fetchFrom({ 'https://one.example/series/alpha/': okRes(`<h1>Alpha Saga</h1><a href="/series/alpha/chapter-1">Chapter 1</a>`) }),
    ));
    // Series 2 — DIFFERENT host (different canonicalId → creates), similar title ("The Alpha Saga").
    const r2 = await created(addSeries(
      { url: 'https://two.example/series/alpha/' },
      fetchFrom({ 'https://two.example/series/alpha/': okRes(`<h1>The Alpha Saga</h1><a href="/series/alpha/chapter-1">Chapter 1</a>`) }),
    ));
    expect(r2.alreadyExisting).toBe(false); // it WAS created, not blocked
    expect(r2.similarTo?.title).toBe('Alpha Saga');
    // A genuinely different title gets no hint.
    const r3 = await created(addSeries(
      { url: 'https://three.example/series/beta/' },
      fetchFrom({ 'https://three.example/series/beta/': okRes(`<h1>Golden Sun</h1><a href="/series/beta/chapter-1">Chapter 1</a>`) }),
    ));
    expect(r3.similarTo == null).toBe(true);
  });

  describe('WP-46: add-time render escalation', () => {
    const WATCH_URL = 'https://reader.example/series/omega/';
    const W1 = 'https://reader.example/series/omega/chapter-1/';
    const W2 = 'https://reader.example/series/omega/chapter-2/';
    const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
    const ROW = (url: string, locked = false) =>
      `<li${locked ? ' class="premium"' : ''}><a href="${url}">Chapter</a></li>`;

    test('WP-46: an under-reading plain TOC at add adopts render and persists fetchMode RENDER', async () => {
      const { seriesId } = await created(addSeries(
        { url: WATCH_URL },
        fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }), // plain reads 1
        fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }), // render reads 2 (more)
      ));
      const source = await db.source.findFirstOrThrow({ where: { seriesId } });
      expect(source.fetchMode).toBe('RENDER');
      expect(await db.chapter.count({ where: { seriesId } })).toBe(2);
    });

    test('WP-46: a hard-fail add recovered by render persists a PAGE_WATCH RENDER source', async () => {
      const url = 'https://cf.example/series/omega/';
      const { seriesId } = await created(addSeries(
        { url },
        fetchFrom({ [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }), // page + feeds blocked
        fetchFrom({ [url]: okRes(TOC(ROW('https://cf.example/series/omega/chapter-1/'))) }),
      ));
      const source = await db.source.findFirstOrThrow({ where: { seriesId } });
      expect(source.type).toBe('PAGE_WATCH');
      expect(source.fetchMode).toBe('RENDER');
    });
  });

  test('WP-49: an un-isolable multi-novel advertised feed + a real page TOC persists a PAGE_WATCH source', async () => {
    const url = 'https://wp.example/novel-toc/';
    const feedUrl = 'https://wp.example/feed/';
    const chapterUrls = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel-toc/ch-${i + 1}/`);
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="${feedUrl}"></head><body><ul>${chapterUrls
      .map((u, i) => `<li><a href="${u}">Chapter ${i + 1}</a></li>`)
      .join('')}</ul></body></html>`;
    const feed = RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/') + ITEM('o2', 'https://wp.example/2026/08/11/misc-ch-9/'));

    const { seriesId } = await created(addSeries({ url }, fetchFrom({ [url]: okRes(page), [feedUrl]: okRes(feed) })));

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.type).toBe('PAGE_WATCH');
    expect(source.feedUrl).toBeNull();

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([...chapterUrls].sort()); // the TOC's chapters, no cross-novel strays
  });
});

describe('listSeries (real DB)', () => {
  test('returns the series with unread = chapter count when unread, plus latest chapter', async () => {
    await addAlpha();
    const list = await listSeries();

    expect(list).toHaveLength(1);
    expect(list[0]!.chapterCount).toBe(2);
    expect(list[0]!.unread).toBe(2);
    expect(list[0]!.latestChapter?.url).toBe(C2);
    expect(list[0]!.activeSource?.host).toBe('translator.example');
  });
});

describe('pollAllSources (real DB)', () => {
  test('detects and persists a new chapter, stays HEALTHY, stores the etag', async () => {
    const seriesId = await addAlpha();

    const pollFetch = fetchFrom({
      [FEED_URL]: okRes(RSS(ITEM('g3', C3) + ITEM('g2', C2) + ITEM('g1', C1)), { etag: '"v2"' }),
    });
    const effects = await pollAllSources(pollFetch);

    expect(effects).toHaveLength(1);
    expect(effects[0]!.newChapters.map((c) => c.guid)).toEqual(['g3']);

    const chapters = await db.chapter.findMany({ where: { seriesId } });
    expect(chapters.map((c) => c.guid).sort()).toEqual(['g1', 'g2', 'g3']);
    // WP-28c: the poll-discovered chapter is stamped announcedAt (a genuine new arrival); the
    // add-imported ones are not, so imports never surface in the digest feed.
    const byGuid = Object.fromEntries(chapters.map((c) => [c.guid, c]));
    expect(byGuid['g3']!.announcedAt).not.toBeNull(); // poll-discovered
    expect(byGuid['g1']!.announcedAt).toBeNull(); // add import
    expect(byGuid['g2']!.announcedAt).toBeNull(); // add import
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.etag).toBe('"v2"');
    expect(source.health).toBe('HEALTHY');
    expect(source.lastSuccessAt).not.toBeNull();
  });

  test('304 not-modified adds nothing new', async () => {
    const seriesId = await addAlpha();
    const notMod: PoliteResult = { outcome: 'SUCCESS', status: 304, notModified: true, body: '', etag: null, lastModified: null, finalUrl: FEED_URL };

    const effects = await pollAllSources(async () => notMod);

    expect(effects[0]!.newChapters).toEqual([]);
    expect(await db.chapter.count({ where: { seriesId } })).toBe(2);
  });

  test('a DNS failure escalates health and records the failure type', async () => {
    const seriesId = await addAlpha();

    await pollAllSources(async () => ({ outcome: 'DNS' }));

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.health).toBe('DEGRADED');
    expect(source.failureScore).toBeGreaterThan(0);
    expect(source.lastFailureType).toBe('DNS');
  });

  test('WP-50: a linkOnly source persists and is selectively excluded from polling', async () => {
    // A normal, genuinely pollable FEED source (isActive, READING, linkOnly false via addAlpha) —
    // proves polling actually ran and reached a normal source, not just that nothing was fetched.
    await addAlpha();

    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Blocked Series',
        sources: { create: { url: 'https://cf.example/series/x/', host: 'cf.example', type: 'PAGE_WATCH', linkOnly: true } },
      },
      include: { sources: true },
    });
    expect(series.sources[0]!.linkOnly).toBe(true);

    const fetched: string[] = [];
    const fetch: FetchImpl = async (url) => {
      fetched.push(url);
      return fetchFrom({ [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) })(url);
    };
    await pollAllSources(fetch);

    // Normal source was reached (polling ran); link-only source was selectively skipped.
    expect(fetched).toContain(FEED_URL);
    expect(fetched).not.toContain('https://cf.example/series/x/');
  });
});

describe('pollAllSources dedup + politeness (real DB)', () => {
  const HUB_FEED = 'https://hub.example/feed/';
  const HUB_A1 = 'https://hub.example/novel-a/chapter-1/';
  const HUB_B1 = 'https://hub.example/novel-b/chapter-1/';

  /** A series bound to the shared HUB_FEED, isolated by a PATH_PREFIX match — the multi-novel
   *  case where several series share one site-wide feed. */
  async function addHubSeries(title: string, pathPrefix: string): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title } });
    await db.source.create({
      data: {
        seriesId: series.id,
        url: HUB_FEED,
        host: 'hub.example',
        type: 'FEED',
        fetchMode: 'PLAIN',
        feedUrl: HUB_FEED,
        matchType: 'PATH_PREFIX',
        matchValue: pathPrefix,
      },
    });
    return series.id;
  }

  test('two series sharing one feed are fetched once and both advance', async () => {
    const seriesA = await addHubSeries('Novel A', '/novel-a/');
    const seriesB = await addHubSeries('Novel B', '/novel-b/');

    let fetches = 0;
    const fetch: FetchImpl = async (url) => {
      if (url === HUB_FEED) fetches++;
      return okRes(RSS(ITEM('ga1', HUB_A1) + ITEM('gb1', HUB_B1)));
    };

    const effects = await pollAllSources(fetch);

    expect(fetches).toBe(1); // one feed URL, fetched once for both series
    expect(effects).toHaveLength(2);

    const chaptersA = await db.chapter.findMany({ where: { seriesId: seriesA } });
    const chaptersB = await db.chapter.findMany({ where: { seriesId: seriesB } });
    expect(chaptersA.map((c) => c.guid)).toEqual(['ga1']);
    expect(chaptersB.map((c) => c.guid)).toEqual(['gb1']);
  });

  test('a host polled less than 15 minutes ago is skipped by the min-interval gate', async () => {
    const seriesId = await addAlpha();
    const now = new Date('2026-01-01T00:20:00.000Z');
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    await db.source.updateMany({ where: { seriesId }, data: { lastCheckedAt: fiveMinAgo } });

    let fetches = 0;
    const fetch: FetchImpl = async (url) => {
      if (url === FEED_URL) fetches++;
      return okRes(RSS(ITEM('g3', C3) + ITEM('g2', C2) + ITEM('g1', C1)));
    };

    const effects = await pollAllSources(fetch, undefined, now);

    expect(fetches).toBe(0); // gated before the fetch — min-interval not yet elapsed
    expect(effects).toEqual([]);

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.lastCheckedAt?.getTime()).toBe(fiveMinAgo.getTime()); // untouched
    expect(source.lastSuccessAt).toBeNull();
    expect(await db.chapter.count({ where: { seriesId } })).toBe(2); // no new chapters
  });

  test('a successful poll clears a stale (expired) backoffUntil', async () => {
    const seriesId = await addAlpha();
    const now = new Date('2026-01-01T00:20:00.000Z');
    const expiredBackoff = new Date(now.getTime() - 60_000); // in the past — gate must NOT skip
    await db.source.updateMany({ where: { seriesId }, data: { backoffUntil: expiredBackoff } });

    await pollAllSources(
      fetchFrom({ [FEED_URL]: okRes(RSS(ITEM('g2', C2) + ITEM('g1', C1))) }),
      undefined,
      now,
    );

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.backoffUntil).toBeNull(); // a healthy poll clears stale backoff
  });
});

describe('page-watch source (real DB)', () => {
  const WATCH_URL = 'https://reader.example/series/omega/';
  const W1 = 'https://reader.example/series/omega/chapter-1/';
  const W2 = 'https://reader.example/series/omega/chapter-2/';
  const W3 = 'https://reader.example/series/omega/chapter-3/';
  const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
  const ROW = (url: string, locked = false) =>
    `<li${locked ? ' class="premium"' : ''}><a href="${url}">Chapter</a></li>`;

  test('adds a PAGE_WATCH source seeded from the TOC, with FREE/LOCKED access', async () => {
    // No feed anywhere (all guesses 404) → page-watch; the page IS the TOC.
    const fetch = fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) });
    const { seriesId } = await created(addSeries({ url: WATCH_URL }, fetch));

    const series = await db.series.findUniqueOrThrow({
      where: { id: seriesId },
      include: { sources: true, chapters: { orderBy: { url: 'asc' } } },
    });
    expect(series.sources[0]!.type).toBe('PAGE_WATCH');
    expect(series.sources[0]!.feedUrl).toBeNull();
    expect(series.chapters.map((c) => c.url)).toEqual([W1, W2]);
    expect(series.chapters.map((c) => c.access)).toEqual(['FREE', 'LOCKED']);
  });

  test('poll parses the TOC, persists only the new chapter with its access, no storm on re-poll', async () => {
    const fetch = fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) });
    const { seriesId } = await created(addSeries({ url: WATCH_URL }, fetch));

    // A third (locked) chapter appears; the first two are unchanged.
    const effects = await pollAllSources(
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true) + ROW(W3, true))) }),
    );

    expect(effects).toHaveLength(1);
    expect(effects[0]!.newChapters.map((c) => c.url)).toEqual([W3]);

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([W1, W2, W3]);
    expect(chapters.find((c) => c.url === W3)!.access).toBe('LOCKED');
  });

  test('a plain page-watch that regresses below stored escalates the source to RENDER (renderer available)', async () => {
    // Seed 3 chapters plainly (no render port at add → stays PLAIN, stored = 3).
    const { seriesId } = await created(addSeries(
      { url: WATCH_URL },
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2) + ROW(W3))) }),
    ));
    // Next poll's plain read returns only 1 chapter (the TOC failed to render) → 1 < 3 → escalate.
    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }), async () => okRes(TOC(ROW(W1))));

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('RENDER');
  });

  test('the same under-read does not escalate when no renderer is configured', async () => {
    const { seriesId } = await created(addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) })));
    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) })); // no render impl

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('PLAIN');
  });

  test('WP-52: a plain page-watch blocked by Cloudflare (403) escalates the source to RENDER', async () => {
    // Seed plainly (no render port at add → stays PLAIN).
    const { seriesId } = await created(addSeries(
      { url: WATCH_URL },
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2) + ROW(W3))) }),
    ));
    // Next poll's plain fetch is Cloudflare-blocked (403) and a renderer is available → escalate.
    await pollAllSources(
      fetchFrom({ [WATCH_URL]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }),
      async () => okRes(TOC(ROW(W1) + ROW(W2) + ROW(W3))),
    );

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('RENDER');
  });

  test('WP-52: a 404 (page gone, not blocked) does not escalate to RENDER', async () => {
    const { seriesId } = await created(addSeries(
      { url: WATCH_URL },
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2) + ROW(W3))) }),
    ));
    await pollAllSources(
      fetchFrom({ [WATCH_URL]: { outcome: 'HTTP_4XX', status: 404 } as PoliteResult }),
      async () => okRes(TOC(ROW(W1))),
    );

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('PLAIN');
  });

  test('WP-20: a stored LOCKED chapter turning FREE stamps becameFreeAt and does not re-fire', async () => {
    // Add with W1 free, W2 locked.
    const { seriesId } = await created(addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) })));

    // Next poll: W2 is now free. Pass an explicit `now` since the host min-interval gate (WP-42)
    // compares against the previous poll's persisted `lastCheckedAt` — the second call below needs
    // to land more than MIN_POLL_INTERVAL_MINUTES later, not just microseconds after this one.
    const t0 = new Date('2026-07-29T12:00:00Z');
    const effects = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }), undefined, t0);
    expect(effects[0]!.becameFree.map((c) => c.url)).toEqual([W2]);
    expect(effects[0]!.newChapters).toEqual([]);

    const w2 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W2 } });
    expect(w2.access).toBe('FREE');
    expect(w2.becameFreeAt).not.toBeNull();

    // A subsequent identical poll, well past the min-interval floor, must not re-detect it
    // (already FREE in storage).
    const t1 = new Date(t0.getTime() + 20 * 60_000); // 20 min later, past the 15-min floor
    const again = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }), undefined, t1);
    expect(again[0]!.becameFree).toEqual([]);
  });

  test('WP-33: a page-watch poll reconciles a stored UNKNOWN chapter to LOCKED, silently', async () => {
    const { seriesId } = await created(addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) })));
    // Force the seeded chapter to UNKNOWN (simulate a feed-originated row).
    await db.chapter.updateMany({ where: { seriesId }, data: { access: 'UNKNOWN' } });

    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1, true))) })); // now marked locked

    const w1 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W1 } });
    expect(w1.access).toBe('LOCKED');
    expect(w1.becameFreeAt).toBeNull(); // reconcile is silent — not an unlock
  });

  test('WP-37: a PAGE_WATCH source with tocUrl polls the TOC page, not the landing url', async () => {
    const LANDING = 'https://pw.example/series/gamma/';
    const TOC = 'https://pw.example/series/gamma/contents/';
    const landingBody = `<html><body><a href="/series/gamma/contents/">Table of Contents</a></body></html>`;
    const seedTocBody = `<html><body><a href="/series/gamma/chapter-1">Chapter 1</a></body></html>`;
    // Add via page-watch; tocUrl is resolved at add (Task 3).
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({ [LANDING]: okRes(landingBody), [TOC]: okRes(seedTocBody) }),
    ));
    await db.source.updateMany({ where: { seriesId }, data: { lastCheckedAt: null } });

    // On poll, only the TOC URL serves a new chapter; the landing url serves nothing new.
    const polledTocBody = `<html><body>
      <a href="/series/gamma/chapter-1">Chapter 1</a>
      <a href="/series/gamma/chapter-2">Chapter 2</a>
    </body></html>`;
    const pollFetch = fetchFrom({
      [LANDING]: okRes(landingBody),
      [TOC]: okRes(polledTocBody),
    });
    await pollAllSources(pollFetch);
    const urls = (await db.chapter.findMany({ where: { seriesId }, select: { url: true } })).map((c) => c.url);
    expect(urls.some((u) => u.endsWith('/chapter-2'))).toBe(true);
  });
});

describe('updateSeries (real DB)', () => {
  test('updates shelf fields, sets finishedAt, and records reading progress', async () => {
    const seriesId = await addAlpha();
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { discoveredAt: 'asc' } });

    const result = await updateSeries(seriesId, { status: 'COMPLETED', rating: 5, lastReadChapterId: chapters[0]!.id });
    expect(result).not.toBeNull();

    const series = await db.series.findUniqueOrThrow({ where: { id: seriesId }, include: { progress: true } });
    expect(series.status).toBe('COMPLETED');
    expect(series.rating).toBe(5);
    expect(series.finishedAt).not.toBeNull();
    expect(series.progress?.lastReadChapterId).toBe(chapters[0]!.id);

    const list = await listSeries();
    expect(list[0]!.unread).toBe(1); // one chapter after the last-read one
  });

  test('returns null for a series that is not the current user’s', async () => {
    expect(await updateSeries('nonexistent-id', { status: 'DROPPED' })).toBeNull();
  });

  test('WP-29: sets an INTERVAL release schedule and stamps lastNotified so it starts next release', async () => {
    const seriesId = await addAlpha();
    const before = new Date();
    const result = await updateSeries(seriesId, {
      releaseSchedule: { kind: 'INTERVAL', cadenceDays: 3, anchoredOn: new Date('2026-08-15T00:00:00Z'), eventKind: 'UNLOCKED' },
    });
    expect(result).not.toBeNull();

    const s = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
    expect(s.releaseScheduleKind).toBe('INTERVAL');
    expect(s.releaseCadenceDays).toBe(3);
    expect(s.releaseAnchoredOn).toEqual(new Date('2026-08-15T00:00:00Z'));
    expect(s.releaseEventKind).toBe('UNLOCKED');
    // Stamped at ~now so evaluateSchedules only fires for the NEXT predicted release, not a backfill.
    expect(s.scheduleLastNotifiedAt).not.toBeNull();
    expect(s.scheduleLastNotifiedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  test('WP-29: sets a WEEKLY release schedule (weekdays + eventKind)', async () => {
    const seriesId = await addAlpha();
    await updateSeries(seriesId, { releaseSchedule: { kind: 'WEEKLY', weekdays: [1, 3, 5], eventKind: 'NEW_CHAPTER' } });

    const s = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
    expect(s.releaseScheduleKind).toBe('WEEKLY');
    expect(s.releaseWeekdays).toEqual([1, 3, 5]);
    expect(s.releaseEventKind).toBe('NEW_CHAPTER');
  });

  test('WP-29: NONE clears every schedule column', async () => {
    const seriesId = await addAlpha();
    await updateSeries(seriesId, { releaseSchedule: { kind: 'WEEKLY', weekdays: [1, 3], eventKind: 'UNLOCKED' } });

    await updateSeries(seriesId, { releaseSchedule: { kind: 'NONE' } });
    const s = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
    expect(s.releaseScheduleKind).toBeNull();
    expect(s.releaseCadenceDays).toBeNull();
    expect(s.releaseAnchoredOn).toBeNull();
    expect(s.releaseWeekdays).toEqual([]);
    expect(s.releaseEventKind).toBe('NEW_CHAPTER');
    expect(s.scheduleLastNotifiedAt).toBeNull();
  });

  test('WP-30: setting title pins titleIsManual, and backfill then leaves it alone', async () => {
    const LANDING = 'https://ut.example/series/omega/';
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/omega/chapter-1">Chapter 1</a>`) }),
    ));

    const result = await updateSeries(seriesId, { title: 'My Hand-Fixed Name' });
    expect(result).not.toBeNull();

    const afterEdit = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(afterEdit.title).toBe('My Hand-Fixed Name');
    expect(afterEdit.titleIsManual).toBe(true);

    // Auto-backfill must not clobber the hand-fix.
    const backfill = await backfillFromToc(
      seriesId,
      fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/omega/chapter-1">Chapter 1</a><a href="/series/omega/chapter-2">Chapter 2</a>`) }),
    );
    const afterBackfill = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(afterBackfill.title).toBe('My Hand-Fixed Name');
    expect(backfill.titleUpdated).toBeUndefined();
  });
});

describe('evaluateSchedules (real DB)', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  test('fires a due scheduled release, stamps it, and does not re-fire on the next run', async () => {
    const seriesId = await addAlpha();
    await db.series.update({
      where: { id: seriesId },
      data: { releaseScheduleKind: 'WEEKLY', releaseWeekdays: [1], releaseEventKind: 'UNLOCKED' },
    });

    // now = Tue Jul 14 → Monday Jul 13 release is due.
    const now = new Date('2026-07-14T09:00:00Z');
    const effects = await evaluateSchedules(now);
    expect(effects).toEqual([{ seriesId, releaseDate: day('2026-07-13'), eventKind: 'UNLOCKED' }]);

    const after = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
    expect(after.scheduleLastNotifiedAt).toEqual(day('2026-07-13'));

    expect(await evaluateSchedules(now)).toEqual([]); // already stamped → no double-fire
  });

  test('a series without a schedule is ignored', async () => {
    await addAlpha();
    expect(await evaluateSchedules(new Date('2026-07-14T09:00:00Z'))).toEqual([]);
  });
});

describe('notifyForEffects (real DB)', () => {
  const HEALTHY = { health: 'HEALTHY', consecutiveFailures: 0, score: 0, lastFailureType: null } as const;
  const effect = (over: Partial<PollEffects>): PollEffects => ({
    sourceId: 'src',
    seriesId: 'series',
    seriesStatus: 'READING',
    health: HEALTHY,
    succeeded: true,
    notModified: false,
    newChapters: [],
    becameFree: [],
    accessReconciled: [],
    etag: null,
    lastModified: null,
    crossedDown: false,
    escalateToRender: false,
    ...over,
  });

  test('builds per-series digest + scheduled messages with real titles', async () => {
    const seriesId = await addAlpha(); // series title "Alpha"
    const captured: PushMessage[] = [];
    const ports: PushSendPorts = {
      loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
      send: async (_t, m) => {
        captured.push(m);
        return 'SENT';
      },
      deleteSubscription: async () => {},
    };

    const summary = await notifyForEffects(
      [effect({ seriesId, newChapters: [{ url: 'u1', title: 'C1' }, { url: 'u2', title: 'C2' }] })],
      [{ seriesId, releaseDate: new Date('2026-07-13T00:00:00Z'), eventKind: 'UNLOCKED' }],
      ports,
    );

    expect(captured.map((m) => ({ title: m.title, body: m.body, tag: m.tag }))).toEqual([
      { title: 'New chapters', body: 'Alpha — 2 new', tag: `new-${seriesId}` },
      { title: 'Likely now free', body: 'Alpha', tag: `sched-${seriesId}` },
    ]);
    expect(summary.sent).toBe(2);
  });

  const captureAll = (): { ports: PushSendPorts; captured: PushMessage[] } => {
    const captured: PushMessage[] = [];
    return {
      captured,
      ports: {
        loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
        send: async (_t, m) => {
          captured.push(m);
          return 'SENT';
        },
        deleteSubscription: async () => {},
      },
    };
  };

  test('a source crossing down produces a "may be down" alert (when source-down push is on)', async () => {
    const seriesId = await addAlpha();
    await updateNotificationPrefs({ pushSourceDown: true }); // default is off — opt in
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ sourceId: source.id, seriesId, crossedDown: true })], [], ports);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.body).toBe(`Alpha — ${source.host} isn't responding`);
    expect(captured[0]!.tag).toBe(`down-${seriesId}`);
  });

  test('by default, source-down is in-app only — no push', async () => {
    const seriesId = await addAlpha();
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ sourceId: source.id, seriesId, crossedDown: true })], [], ports);

    expect(captured).toEqual([]); // pushSourceDown defaults off
  });

  test('an EXPIRED push channel (404/410) is pruned — independent of source health', async () => {
    const seriesId = await addAlpha();
    await db.pushSubscription.create({ data: { userId: 'local', endpoint: 'gone', p256dh: 'p', auth: 'a' } });
    const ports: PushSendPorts = {
      loadSubscriptions: async () =>
        db.pushSubscription.findMany({ select: { endpoint: true, p256dh: true, auth: true } }) as Promise<PushTarget[]>,
      send: async () => 'EXPIRED', // the push service says this device's channel is gone
      deleteSubscription: async (endpoint) => {
        await db.pushSubscription.delete({ where: { endpoint } });
      },
    };

    // A plain new-chapter effect (source is HEALTHY) — pruning has nothing to do with the site.
    const summary = await notifyForEffects([effect({ seriesId, newChapters: [{ url: 'u', title: 'C' }] })], [], ports);

    expect(summary.expired).toBe(1);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  test('WP-20: becameFree → a "Now free" push; a locked-only new chapter is not pushed', async () => {
    const seriesId = await addAlpha(); // title "Alpha"
    const { ports, captured } = captureAll();

    await notifyForEffects(
      [
        effect({
          seriesId,
          becameFree: [{ url: 'u-unlocked', access: 'FREE' }],
          newChapters: [{ url: 'u-locked', title: 'C3', access: 'LOCKED' }],
        }),
      ],
      [],
      ports,
    );

    // Only the unlock is pushed; the new *locked* chapter is stored-silently (no new-chapter push).
    expect(captured.map((m) => ({ title: m.title, body: m.body, tag: m.tag }))).toEqual([
      { title: 'Now free', body: 'Alpha', tag: `free-${seriesId}` },
    ]);
  });

  test('WP-20: a new FREE chapter still pushes as a normal new chapter', async () => {
    const seriesId = await addAlpha();
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ seriesId, newChapters: [{ url: 'u', title: 'C', access: 'FREE' }] })], [], ports);

    expect(captured.map((m) => m.title)).toEqual(['New chapter']);
  });

  test('WP-27a: a non-READING series does not push new chapters or now-free', async () => {
    const readingId = await addAlpha(); // status defaults READING
    const planned = await db.series.create({ data: { userId: getCurrentUserId(), title: 'Planned', status: 'PLANNED' } });
    const captured: PushMessage[] = [];
    const ports: PushSendPorts = {
      loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
      send: async (_t, m) => { captured.push(m); return 'SENT'; },
      deleteSubscription: async () => {},
    };

    await notifyForEffects(
      [
        effect({ seriesId: readingId, seriesStatus: 'READING', newChapters: [{ url: 'r1', title: 'R1', access: 'FREE' }] }),
        effect({ seriesId: planned.id, seriesStatus: 'PLANNED', newChapters: [{ url: 'p1', title: 'P1', access: 'FREE' }], becameFree: [{ url: 'p0', access: 'FREE' }] }),
      ],
      [],
      ports,
    );

    // Only the READING series produced a push; the PLANNED one is silent.
    expect(captured.map((m) => m.tag)).toEqual([`new-${readingId}`]);
  });
});

describe('notification preferences (real DB)', () => {
  test('defaults when unset: new + scheduled on, source-down off', async () => {
    expect(await getNotificationPrefs()).toEqual({ pushNewChapter: true, pushScheduled: true, pushSourceDown: false });
  });

  test('a partial update upserts and persists, leaving other toggles at their default', async () => {
    const updated = await updateNotificationPrefs({ pushSourceDown: true });
    expect(updated).toEqual({ pushNewChapter: true, pushScheduled: true, pushSourceDown: true });
    // a second partial update only touches its field
    await updateNotificationPrefs({ pushNewChapter: false });
    expect(await getNotificationPrefs()).toEqual({ pushNewChapter: false, pushScheduled: true, pushSourceDown: true });
  });
});

describe('backfillFromToc (real DB)', () => {
  const PAGE = 'https://translator.example/novel/alpha/';
  const B1 = 'https://translator.example/a-1/';
  const B2 = 'https://translator.example/a-2/';
  const B3 = 'https://translator.example/a-3/';
  const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
  const ROW = (u: string, locked = false) => `<li${locked ? ' class="premium"' : ''}><a href="${u}">Chapter</a></li>`;

  test('adds older chapters missing from the feed window and reconciles access, without pushing', async () => {
    // addAlpha() seeds a FEED series with 2 chapters (a-1, a-2) as access UNKNOWN, source.url = the series page.
    const seriesId = await addAlpha();
    // Point the source's reading page at our TOC (which shows the full history a-1..a-3, a-2 locked).
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    const result = await backfillFromToc(
      seriesId,
      fetchFrom({ [PAGE]: okRes(TOC(ROW(B1) + ROW(B2, true) + ROW(B3))) }),
    );

    expect(result.added).toBe(1); // a-3 was missing
    expect(result.reconciled).toBe(2); // a-1 → FREE, a-2 → LOCKED (were UNKNOWN)

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([B1, B2, B3]);
    expect(chapters.find((c) => c.url === B1)!.access).toBe('FREE');
    expect(chapters.find((c) => c.url === B2)!.access).toBe('LOCKED');
    expect(chapters.find((c) => c.url === B3)!.access).toBe('FREE');
    // a-1 went UNKNOWN → FREE via reconciliation, not an unlock — becameFreeAt must stay
    // null, since that's the field a real unlock stamps to trigger a "Now free" push (WP-20).
    // A set becameFreeAt here would mean this silent backfill created a push-worthy event.
    expect(chapters.find((c) => c.url === B1)!.becameFreeAt).toBeNull();
  });

  test('WP-37: backfill fetches a stored tocUrl, not the landing url', async () => {
    const LANDING = 'https://bf.example/series/delta/';
    const TOC = 'https://bf.example/series/delta/contents/';
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({
        [LANDING]: okRes(`<a href="/series/delta/contents/">Table of Contents</a>`),
        [TOC]: okRes(`<a href="/series/delta/chapter-1">Chapter 1</a>`),
      }),
    ));
    // Backfill sees a fuller TOC at the TOC url; the landing url would 0-out.
    const added = await backfillFromToc(
      seriesId,
      fetchFrom({
        [LANDING]: okRes(`<a href="/series/delta/contents/">Table of Contents</a>`),
        [TOC]: okRes(`<a href="/series/delta/chapter-1">Chapter 1</a><a href="/series/delta/chapter-2">Chapter 2</a>`),
      }),
    );
    // The landing page's own body has no chapter anchors (only the TOC link), so add-time
    // seeds zero chapters (Task 3 parses only the landing page, never the discovered tocUrl
    // page) — both chapter-1 and chapter-2 are new here. This proves backfill reads the
    // richer TOC page (via the stored tocUrl) rather than the landing url, which would 0-out.
    expect(added.added).toBe(2);
  });

  test('WP-37: backfill self-heals a null tocUrl by discovering + persisting the TOC link', async () => {
    // Simulate a pre-WP-37 series: create it, then blank its tocUrl.
    const LANDING = 'https://heal.example/series/epsilon/';
    const TOC = 'https://heal.example/series/epsilon/contents/';
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({
        [LANDING]: okRes(`<a href="/series/epsilon/contents/">Table of Contents</a>`),
        [TOC]: okRes(`<a href="/series/epsilon/chapter-1">Chapter 1</a>`),
      }),
    ));
    await db.source.updateMany({ where: { seriesId }, data: { tocUrl: null } });

    const added = await backfillFromToc(
      seriesId,
      fetchFrom({
        [LANDING]: okRes(`<a href="/series/epsilon/contents/">Table of Contents</a>`),
        [TOC]: okRes(`<a href="/series/epsilon/chapter-1">Chapter 1</a><a href="/series/epsilon/chapter-2">Chapter 2</a>`),
      }),
    );
    // Same reasoning as the previous test: add-time seeded zero chapters (landing page has no
    // chapter anchors of its own), so both chapter-1 and chapter-2 are new via the self-healed TOC.
    expect(added.added).toBe(2);
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.tocUrl).toBe(TOC); // persisted for next time
  });

  test('WP-37: backfill via tocUrl diffs against stored chapters (skips an already-seen one)', async () => {
    const LANDING = 'https://skip.example/series/theta/';
    const TOC = 'https://skip.example/series/theta/contents/';
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({
        // Landing carries chapter-1 (seeded at add) AND the TOC link.
        [LANDING]: okRes(
          `<a href="/series/theta/chapter-1">Chapter 1</a><a href="/series/theta/contents/">Table of Contents</a>`,
        ),
        [TOC]: okRes(`<a href="/series/theta/chapter-1">Chapter 1</a>`),
      }),
    ));
    // Confirm add-time actually seeded chapter-1 (parseToc picks up the "Chapter 1" anchor
    // on the landing page itself, unlike the other two WP-37 tests above, whose landing
    // fixtures carry only the TOC link and so seed zero chapters).
    const seeded = await db.chapter.findMany({ where: { seriesId } });
    expect(seeded.map((c) => c.url)).toEqual(['https://skip.example/series/theta/chapter-1']);

    const added = await backfillFromToc(
      seriesId,
      fetchFrom({
        [LANDING]: okRes(
          `<a href="/series/theta/chapter-1">Chapter 1</a><a href="/series/theta/contents/">Table of Contents</a>`,
        ),
        [TOC]: okRes(
          `<a href="/series/theta/chapter-1">Chapter 1</a><a href="/series/theta/chapter-2">Chapter 2</a>`,
        ),
      }),
    );
    expect(added.added).toBe(1); // chapter-1 already stored → only chapter-2 is new
    const chapters = await db.chapter.findMany({ where: { seriesId } });
    expect(chapters).toHaveLength(2); // no duplicate chapter-1
  });

  test('WP-30: backfill repairs a non-manual title from the landing body (self-heal path, no extra fetch)', async () => {
    const LANDING = 'https://bft.example/series/rho/';
    const TOC = 'https://bft.example/series/rho/contents/';
    // Add page-watch with a bad slug title (no <h1> at add) so the stored title is the slug.
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({ [LANDING]: okRes(`<a href="/series/rho/contents/">Table of Contents</a>`) }),
    ));
    await db.source.updateMany({ where: { seriesId }, data: { tocUrl: null } }); // force self-heal
    // Count fetches; landing now HAS an <h1>; self-heal fetches landing (for the TOC link) → title is free.
    const seen: string[] = [];
    const fetch = ((u: string) => {
      seen.push(u);
      if (u === LANDING) return Promise.resolve(okRes(`<h1>The Rho Saga</h1><a href="/series/rho/contents/">Table of Contents</a>`));
      if (u === TOC) return Promise.resolve(okRes(`<a href="/series/rho/chapter-1">Chapter 1</a>`));
      return Promise.resolve({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);
    }) as FetchImpl;
    const result = await backfillFromToc(seriesId, fetch);
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(series.title).toBe('The Rho Saga');
    expect(result.titleUpdated).toBe('The Rho Saga');
    expect(seen.filter((u) => u === LANDING)).toHaveLength(1); // landing fetched once (for the TOC link) — no extra title fetch
  });

  test('WP-30: backfill does NOT overwrite a manual title', async () => {
    const LANDING = 'https://bft2.example/series/sigma/';
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/sigma/chapter-1">Chapter 1</a>`) }),
    ));
    await db.series.updateMany({ where: { id: seriesId }, data: { title: 'My Hand-Fixed Name', titleIsManual: true } });
    const result = await backfillFromToc(
      seriesId,
      fetchFrom({ [LANDING]: okRes(`<h1>Auto Name</h1><a href="/series/sigma/chapter-1">Chapter 1</a><a href="/series/sigma/chapter-2">Chapter 2</a>`) }),
    );
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(series.title).toBe('My Hand-Fixed Name'); // untouched
    expect(result.titleUpdated).toBeUndefined();
  });

  test('WP-30: backfill on a tocUrl-set series does the extra landing fetch to repair the title', async () => {
    const LANDING = 'https://xf.example/series/tau/';
    const TOC = 'https://xf.example/series/tau/contents/';
    // Page-watch add with NO <h1> → stored title is the slug ("Tau").
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({ [LANDING]: okRes(`<a href="/series/tau/chapter-1">Chapter 1</a>`) }),
    ));
    const seeded = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(seeded.title).toBe('Tau'); // confirm the slug fallback landed at add-time
    await db.source.updateMany({ where: { seriesId }, data: { tocUrl: TOC } }); // force tocUrl-set path
    const seen: string[] = [];
    const fetch = ((u: string) => {
      seen.push(u);
      if (u === TOC) return Promise.resolve(okRes(`<a href="/series/tau/chapter-1">Chapter 1</a><a href="/series/tau/chapter-2">Chapter 2</a>`));
      if (u === LANDING) return Promise.resolve(okRes(`<h1>The Tau Cycle</h1><a href="/series/tau/chapter-1">Chapter 1</a>`));
      return Promise.resolve({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);
    }) as FetchImpl;
    const result = await backfillFromToc(seriesId, fetch);
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(series.title).toBe('The Tau Cycle'); // repaired from the extra landing fetch
    expect(result.titleUpdated).toBe('The Tau Cycle');
    expect(seen).toContain(TOC); // chapters fetched from the TOC url
    expect(seen.filter((u) => u === LANDING)).toHaveLength(1); // exactly one extra title fetch
  });

  test('WP-30: backfill leaves the title unchanged when the extra landing fetch fails', async () => {
    const LANDING = 'https://xf2.example/series/upsilon/';
    const TOC = 'https://xf2.example/series/upsilon/contents/';
    const { seriesId } = await created(addSeries(
      { url: LANDING },
      fetchFrom({ [LANDING]: okRes(`<a href="/series/upsilon/chapter-1">Chapter 1</a>`) }),
    ));
    await db.source.updateMany({ where: { seriesId }, data: { tocUrl: TOC } });
    const before = (await db.series.findFirstOrThrow({ where: { id: seriesId } })).title;
    const fetch = ((u: string) => {
      if (u === TOC) return Promise.resolve(okRes(`<a href="/series/upsilon/chapter-1">Chapter 1</a>`)); // TOC has NO heading
      // LANDING (and anything else) fails → title falls back to the TOC body → extractSeriesTitle null → no update
      return Promise.resolve({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);
    }) as FetchImpl;
    const result = await backfillFromToc(seriesId, fetch);
    const series = await db.series.findFirstOrThrow({ where: { id: seriesId } });
    expect(result.titleUpdated).toBeUndefined();
    expect(series.title).toBe(before); // unchanged
  });
});

describe('WP-35: chapter positions (real DB)', () => {
  const WATCH = 'https://reader.example/series/omega/';
  const rows = ['chapter-1', 'chapter-2', 'chapter-3']
    .map((s) => `<li><a href="${WATCH}${s}/">${s}</a></li>`)
    .join('');

  test('add seeds chapter positions from the TOC order', async () => {
    const { seriesId } = await created(addSeries(
      { url: WATCH },
      fetchFrom({ [WATCH]: okRes(`<html><body><ul>${rows}</ul></body></html>`) }),
    ));
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.find((c) => c.url.endsWith('chapter-1/'))!.position).toBe(0);
    expect(chapters.find((c) => c.url.endsWith('chapter-2/'))!.position).toBe(1);
    expect(chapters.find((c) => c.url.endsWith('chapter-3/'))!.position).toBe(2);
  });

  // getSeries/listSeries return chapters in position order (not number/date), for a positioned series.
  // Build the series with a position order that DIFFERS from number/discovery order to prove position wins:
  // direct db inserts, chapter "1" at position 2 (last) and chapter "3" at position 0 (first).
  test('getSeries and listSeries order by position', async () => {
    // This test only needs a Series + Source row to attach hand-inserted chapters to — it doesn't
    // exercise add-time resolution. A page with neither chapters nor a discoverable TOC would now
    // (WP-50) need user confirmation, so seed directly via allowLinkOnly instead of a fetch fixture.
    const { seriesId } = await created(addSeries({ url: WATCH, allowLinkOnly: true }, fetchFrom({})));
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    await db.chapter.createMany({
      data: [
        { seriesId, sourceId: source.id, title: 'Chapter 1', url: `${WATCH}chapter-1/`, number: 1, position: 2 },
        { seriesId, sourceId: source.id, title: 'Chapter 2', url: `${WATCH}chapter-2/`, number: 2, position: 1 },
        { seriesId, sourceId: source.id, title: 'Chapter 3', url: `${WATCH}chapter-3/`, number: 3, position: 0 },
      ],
    });

    const series = await getSeries(seriesId);
    expect(series!.chapters.map((c) => c.url)).toEqual([`${WATCH}chapter-3/`, `${WATCH}chapter-2/`, `${WATCH}chapter-1/`]);

    const list = await listSeries();
    const entry = list.find((s) => s.id === seriesId)!;
    expect(entry.latestChapter?.url).toBe(`${WATCH}chapter-1/`); // last in position order = highest position
  });

  // backfillFromToc re-indexes positions of existing chapters + sets them on the newly-added tail.
  test('backfill assigns/re-indexes positions from the TOC', async () => {
    const seriesId = await addAlpha(); // feed series a-1, a-2, positions null
    const PAGE = 'https://translator.example/novel/alpha/';
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    // Descending TOC (newest-first, well-formed trend) with a-3 added as the oldest, so the resulting
    // reading-order position differs from insertion/number order and proves the re-index actually ran.
    const TOC =
      `<html><body><ul>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `</ul></body></html>`;
    const result = await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(TOC) }));
    expect(result.added).toBe(1); // a-3 was missing

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.find((c) => c.url === C1)!.position).toBe(0);
    expect(chapters.find((c) => c.url === C2)!.position).toBe(1);
    expect(chapters.find((c) => c.url === C3)!.position).toBe(2);
  });

  // A partial/windowed TOC (missing a chapter the store already has, e.g. a site trimming to its
  // recent window) must NOT re-index — that would collide the TOC-present chapters' fresh 0..N-1
  // block with the untouched position of the chapter the TOC dropped. Positions must stay as-is,
  // and any newly-discovered chapter must get position: null (sorts last = newest).
  test('backfill leaves positions untouched when the TOC is missing a stored chapter', async () => {
    const seriesId = await addAlpha(); // feed series a-1, a-2, positions null
    const PAGE = 'https://translator.example/novel/alpha/';
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    // Step 1: a full TOC (a-3, a-2, a-1, descending) backfills a-3 and re-indexes all three to
    // a-1=0, a-2=1, a-3=2 — same as the "re-indexes positions from the TOC" case above.
    const FULL_TOC =
      `<html><body><ul>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `</ul></body></html>`;
    await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(FULL_TOC) }));
    const afterFull = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(afterFull.find((c) => c.url === C1)!.position).toBe(0);
    expect(afterFull.find((c) => c.url === C2)!.position).toBe(1);
    expect(afterFull.find((c) => c.url === C3)!.position).toBe(2);

    // Step 2: the site trims its TOC to a recent window that drops a-1 and adds a new a-4
    // (a-4, a-3, a-2, descending). a-1 is stored but absent from this TOC → partial → no re-index.
    const C4 = 'https://translator.example/a-4/';
    const PARTIAL_TOC =
      `<html><body><ul>` +
      `<li><a href="${C4}">Chapter 4</a></li>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `</ul></body></html>`;
    const result = await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(PARTIAL_TOC) }));
    expect(result.added).toBe(1); // a-4 was missing

    const afterPartial = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    // Existing chapters keep their step-1 positions — untouched, no collision.
    expect(afterPartial.find((c) => c.url === C1)!.position).toBe(0);
    expect(afterPartial.find((c) => c.url === C2)!.position).toBe(1);
    expect(afterPartial.find((c) => c.url === C3)!.position).toBe(2);
    // The newly-added chapter gets no position (sorts last = newest), not a colliding re-index.
    expect(afterPartial.find((c) => c.url === C4)!.position).toBeNull();
  });

  // A feed-ahead chapter (newest, published to the feed but not yet on the hand-maintained TOC
  // page) is stored with position: null. Unlike the windowed case above, it must NOT block the
  // re-index: it's unpositioned, so leaving it null (sorts last = newest) collides with nothing.
  // The TOC-covered chapters still get their positions. This is the split-title feed-ahead case — Part 2's
  // newest chapter arrives via feed before the TOC index page lists it, leaving the whole series
  // unpositioned and falling back to the (two-part-colliding) number order.
  test('backfill re-indexes when the only absent-from-TOC chapter is unpositioned (feed-ahead)', async () => {
    const seriesId = await addAlpha(); // feed series a-1, a-2, positions null
    const PAGE = 'https://translator.example/novel/alpha/';
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    // A feed-ahead chapter: newest, stored (null position), and NOT on the TOC yet.
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const C9 = 'https://translator.example/a-9/';
    await db.chapter.create({
      data: { seriesId, sourceId: source.id, title: 'Chapter 9', url: C9, number: 9, position: null },
    });

    // Full-history TOC (a-3, a-2, a-1 descending): covers a-1/a-2, adds a-3, omits the feed-ahead a-9.
    const TOC =
      `<html><body><ul>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `</ul></body></html>`;
    const result = await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(TOC) }));
    expect(result.added).toBe(1); // a-3

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    // TOC-covered chapters get re-indexed — the feed-ahead a-9 did not block it.
    expect(chapters.find((c) => c.url === C1)!.position).toBe(0);
    expect(chapters.find((c) => c.url === C2)!.position).toBe(1);
    expect(chapters.find((c) => c.url === C3)!.position).toBe(2);
    // The feed-ahead chapter stays null → sorts last (newest).
    expect(chapters.find((c) => c.url === C9)!.position).toBeNull();
  });
});

describe('savePushSubscription (real DB)', () => {
  test('upserts by endpoint — re-subscribing updates keys, not row count', async () => {
    await savePushSubscription({ endpoint: 'https://push.example/e1', p256dh: 'p', auth: 'a' });
    await savePushSubscription({ endpoint: 'https://push.example/e1', p256dh: 'p2', auth: 'a2' });

    const subs = await db.pushSubscription.findMany();
    expect(subs).toHaveLength(1);
    expect(subs[0]!.p256dh).toBe('p2');
  });
});

describe('pollAllSources status gating (real DB, WP-27a)', () => {
  async function seedStatus(status: 'READING' | 'PLANNED' | 'PAUSED' | 'COMPLETED' | 'DROPPED', host: string, lastCheckedAt: Date | null): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title: status, status } });
    await db.source.create({
      data: { seriesId: series.id, url: `https://${host}/rss`, host, type: 'FEED', fetchMode: 'PLAIN', feedUrl: `https://${host}/rss`, matchType: 'WHOLE_FEED', lastCheckedAt },
    });
    return series.id;
  }

  test('COMPLETED / DROPPED / PAUSED are never polled', async () => {
    const ids = {
      completed: await seedStatus('COMPLETED', 'c.example', null),
      dropped: await seedStatus('DROPPED', 'd.example', null),
      paused: await seedStatus('PAUSED', 'pa.example', null),
    };
    const fetch = fetchFrom({}); // any fetch would 404; we assert none happen
    const effects = await pollAllSources(fetch);
    expect(effects).toEqual([]);
    for (const id of Object.values(ids)) {
      const src = await db.source.findFirstOrThrow({ where: { seriesId: id } });
      expect(src.lastCheckedAt).toBeNull();
    }
  });

  test('PLANNED is polled only when past its weekly window', async () => {
    const freshLastCheckedAt = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    const fresh = await seedStatus('PLANNED', 'fresh.example', freshLastCheckedAt);
    const stale = await seedStatus('PLANNED', 'stale.example', new Date(Date.now() - 8 * 24 * 60 * 60_000));
    const fetch = fetchFrom({ 'https://stale.example/rss': okRes(RSS('')), 'https://fresh.example/rss': okRes(RSS('')) });
    const effects = await pollAllSources(fetch);
    expect(effects.map((e) => e.seriesId)).toEqual([stale]);
    // Not due (< 7d cadence) → untouched, not stamped by this poll.
    expect((await db.source.findFirstOrThrow({ where: { seriesId: fresh } })).lastCheckedAt?.getTime()).toBe(
      freshLastCheckedAt.getTime(),
    );
  });

  test('a not-due PLANNED source riding a shared feed with a READING source is processed (ride-along)', async () => {
    const SHARED = 'https://shared-feed.example/rss';
    const reading = await db.series.create({ data: { userId: getCurrentUserId(), title: 'R-shared', status: 'READING' } });
    const planned = await db.series.create({ data: { userId: getCurrentUserId(), title: 'P-shared', status: 'PLANNED' } });
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60_000); // 2 days ago — well inside the weekly window (not due on its own)
    for (const [seriesId, lastCheckedAt] of [[reading.id, null], [planned.id, recent]] as const) {
      await db.source.create({
        data: { seriesId, url: SHARED, host: 'shared-feed.example', type: 'FEED', fetchMode: 'PLAIN', feedUrl: SHARED, matchType: 'WHOLE_FEED', lastCheckedAt },
      });
    }

    const effects = await pollAllSources(fetchFrom({ [SHARED]: okRes(RSS(ITEM('g1', 'https://shared-feed.example/c1'))) }));

    // The due READING source triggers the one shared fetch; the not-due PLANNED source rides along
    // (processed for free) rather than being left stale — both store the chapter.
    expect(effects.map((e) => e.seriesId).sort()).toEqual([planned.id, reading.id].sort());
    expect(await db.chapter.count({ where: { seriesId: reading.id } })).toBe(1);
    expect(await db.chapter.count({ where: { seriesId: planned.id } })).toBe(1);
    expect((await db.source.findFirstOrThrow({ where: { seriesId: planned.id } })).lastCheckedAt).not.toBeNull();
  });
});

describe('pollAllSources tier filter (real DB, WP-43)', () => {
  const PLAIN_FEED = 'https://plain.example/feed/';
  const RENDER_FEED = 'https://render.example/feed/';
  const WATCH_URL = 'https://watch.example/toc/';

  /** Seed one source of a given type/fetchMode bound to a fresh series. Returns the source id. */
  async function seedSource(args: {
    title: string;
    url: string;
    host: string;
    type: 'FEED' | 'PAGE_WATCH';
    fetchMode: 'PLAIN' | 'RENDER';
  }): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title: args.title } });
    const source = await db.source.create({
      data: {
        seriesId: series.id,
        url: args.url,
        host: args.host,
        type: args.type,
        fetchMode: args.fetchMode,
        feedUrl: args.type === 'FEED' ? args.url : null,
        matchType: 'WHOLE_FEED',
      },
    });
    return source.id;
  }

  test("tier='plain' polls only FEED+PLAIN; RENDER and PAGE_WATCH are untouched", async () => {
    const plainId = await seedSource({ title: 'PlainFeed', url: PLAIN_FEED, host: 'plain.example', type: 'FEED', fetchMode: 'PLAIN' });
    const renderId = await seedSource({ title: 'RenderFeed', url: RENDER_FEED, host: 'render.example', type: 'FEED', fetchMode: 'RENDER' });
    const watchId = await seedSource({ title: 'PageWatch', url: WATCH_URL, host: 'watch.example', type: 'PAGE_WATCH', fetchMode: 'PLAIN' });

    // Fetch serves every url, so "not polled" can only be due to the tier filter, not a fetch miss.
    const fetch = fetchFrom({ [PLAIN_FEED]: okRes(RSS('')), [RENDER_FEED]: okRes(RSS('')), [WATCH_URL]: okRes('<html></html>') });
    const effects = await pollAllSources(fetch, undefined, undefined, 'plain');

    expect(effects.map((e) => e.sourceId)).toEqual([plainId]);
    // The excluded sources were never polled → lastCheckedAt stays null.
    expect((await db.source.findFirstOrThrow({ where: { id: renderId } })).lastCheckedAt).toBeNull();
    expect((await db.source.findFirstOrThrow({ where: { id: watchId } })).lastCheckedAt).toBeNull();
    expect((await db.source.findFirstOrThrow({ where: { id: plainId } })).lastCheckedAt).not.toBeNull();
  });

  test("tier='all' polls every active source (filter does not leak into the default path)", async () => {
    await seedSource({ title: 'PlainFeed', url: PLAIN_FEED, host: 'plain.example', type: 'FEED', fetchMode: 'PLAIN' });
    await seedSource({ title: 'RenderFeed', url: RENDER_FEED, host: 'render.example', type: 'FEED', fetchMode: 'RENDER' });
    await seedSource({ title: 'PageWatch', url: WATCH_URL, host: 'watch.example', type: 'PAGE_WATCH', fetchMode: 'PLAIN' });

    const fetch = fetchFrom({ [PLAIN_FEED]: okRes(RSS('')), [RENDER_FEED]: okRes(RSS('')), [WATCH_URL]: okRes('<html></html>') });
    const effects = await pollAllSources(fetch, undefined, undefined, 'all');

    expect(effects).toHaveLength(3);
  });
});

describe('setApiDescriptor (real DB, WP-45)', () => {
  test('setApiDescriptor flips a source to API with endpoint + descriptor', async () => {
    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Alpha',
        sources: { create: { url: 'https://spa.example/series/alpha', host: 'spa.example', type: 'FEED', feedUrl: 'https://spa.example/feed/' } },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0]!.id;

    const res = await setApiDescriptor(sourceId, {
      endpoint: 'https://api.example/works/1/chapters',
      map: { urlField: 'url', titleField: 'title', isFreeField: 'free' },
    });
    expect(res.updated).toBe(true);

    const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(row.type).toBe('API');
    expect(row.apiUrl).toBe('https://api.example/works/1/chapters');
    expect(row.feedUrl).toBeNull();
    expect(row.fetchMode).toBe('PLAIN');
    expect(row.apiMap).toMatchObject({ urlField: 'url', isFreeField: 'free' });
  });

  test('WP-45: add-time probe persists an API source (static-JSON shape, chapter seeded)', async () => {
    const url = 'https://spa.example/series/alpha';
    const apiUrl = 'https://spa.example/data/alpha.json';
    const shell = `<html><body><div data-title="/data/alpha.json"></div></body></html>`;
    const chapterUrl = 'https://spa.example/read/1';
    const apiBody = JSON.stringify([{ title: 'Ch 1', url: chapterUrl }]);

    // Add-time probe: the shell's data-title pointer to a .json file triggers probeForApi, which
    // reads the flat-array static-JSON shape (no isFree) and persists an API source.
    const { seriesId } = await created(addSeries({ url }, fetchFrom({ [url]: okRes(shell), [apiUrl]: okRes(apiBody) })));

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.type).toBe('API');
    expect(source.apiUrl).toBe(apiUrl);
    expect(source.apiMap).toMatchObject({ urlField: 'url', titleField: 'title' });
    const seeded = await db.chapter.findFirstOrThrow({ where: { seriesId, url: chapterUrl } });
    expect(seeded).toBeTruthy();
  });

  test('WP-45/WP-20: an isFree-aware API source polls a chapter in LOCKED, then a later poll observes it unlock', async () => {
    // A plain-REST API source, wired via the CLI escape hatch (setApiDescriptor) since the
    // add-time auto-probe only detects the static-JSON shell shape, not a bare REST endpoint.
    const apiUrl = 'https://api.example/works/1/chapters';
    const chapterUrl = 'https://api.example/read/1';
    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Beta',
        sources: { create: { url: 'https://api.example/series/beta', host: 'api.example', type: 'FEED', feedUrl: 'https://api.example/feed/' } },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0]!.id;
    await setApiDescriptor(sourceId, {
      endpoint: apiUrl,
      map: { urlField: 'url', numberField: 'num', titleField: 'title', isFreeField: 'free' },
    });

    // Poll 1: the API reports the chapter locked (free: false) — no manual DB write, the poll
    // itself must be what stores it as LOCKED via the real API-adapter diff.
    const t0 = new Date('2026-07-29T12:00:00Z');
    await pollAllSources(
      fetchFrom({ [apiUrl]: okRes(JSON.stringify([{ num: 1, title: 'Ch 1', url: chapterUrl, free: false }])) }),
      undefined,
      t0,
    );
    const locked = await db.chapter.findFirstOrThrow({ where: { seriesId: series.id, url: chapterUrl } });
    expect(locked.access).toBe('LOCKED');
    expect(locked.becameFreeAt).toBeNull();

    // Poll 2, past the WP-42 host min-poll-interval floor: the API now reports it free →
    // becameFree flips access + stamps becameFreeAt, persisted end-to-end through the real DB.
    const t1 = new Date(t0.getTime() + 20 * 60_000); // 20 min later, past the 15-min floor
    const effects = await pollAllSources(
      fetchFrom({ [apiUrl]: okRes(JSON.stringify([{ num: 1, title: 'Ch 1', url: chapterUrl, free: true }])) }),
      undefined,
      t1,
    );
    expect(effects[0]!.becameFree.map((c) => c.url)).toEqual([chapterUrl]);

    const unlocked = await db.chapter.findFirstOrThrow({ where: { seriesId: series.id, url: chapterUrl } });
    expect(unlocked.access).toBe('FREE');
    expect(unlocked.becameFreeAt).not.toBeNull();

    // Poll 3, same body, well past the floor again: already FREE in storage, must not re-fire.
    const t2 = new Date(t1.getTime() + 20 * 60_000);
    const again = await pollAllSources(
      fetchFrom({ [apiUrl]: okRes(JSON.stringify([{ num: 1, title: 'Ch 1', url: chapterUrl, free: true }])) }),
      undefined,
      t2,
    );
    expect(again[0]!.becameFree).toEqual([]);
  });

  test('WP-45b: setApiDescriptor persists a pagination descriptor with render=true', async () => {
    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Gamma',
        sources: { create: { url: 'https://cf.example/series/gamma', host: 'cf.example', type: 'FEED', feedUrl: 'https://cf.example/feed/' } },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0]!.id;

    const res = await setApiDescriptor(sourceId, {
      endpoint: 'https://api.cf.example/works/1/chapters',
      map: {
        urlField: 'permalink',
        titleField: 'title',
        isFreeField: 'locked',
        isFreeWhen: 'falsy',
        pagination: { pageParam: 'page', perPage: 200 },
      },
      render: true,
    });
    expect(res.updated).toBe(true);

    const row = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(row.type).toBe('API');
    expect(row.fetchMode).toBe('RENDER');
    expect(row.apiMap).toMatchObject({ pagination: { pageParam: 'page', perPage: 200 } });
  });

  test('WP-45b: a paginated PLAIN API source unions every page through a real poll', async () => {
    // Wired the same way as the WP-45/WP-20 case: a FEED-shaped source flipped to API via the
    // CLI escape hatch, this time with a `pagination` descriptor. Page 1 comes back FULL
    // (perPage items) so fetchApiPages must keep going; page 2 comes back SHORT so it must stop
    // there — proving both the "keep paging" and "stop paging" halves of the loop, plus that the
    // two pages' items are unioned into storage through the real pollAllSources seam (not just
    // the pure fetchApiPages unit under test elsewhere).
    const apiUrl = 'https://api.example/works/1/chapters?per_page=200';
    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Delta',
        sources: { create: { url: 'https://api.example/series/delta', host: 'api.example', type: 'FEED', feedUrl: 'https://api.example/feed/' } },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0]!.id;
    await setApiDescriptor(sourceId, {
      endpoint: apiUrl,
      map: {
        urlField: 'url',
        titleField: 'title',
        isFreeField: 'locked',
        isFreeWhen: 'falsy',
        pagination: { pageParam: 'page', perPage: 200 },
      },
    });

    const chapter = (n: number) => ({ url: `https://api.example/read/${n}`, title: `Ch ${n}`, locked: false });
    const page1 = Array.from({ length: 200 }, (_, i) => chapter(i + 1)); // full page → keep paging
    const page2 = Array.from({ length: 18 }, (_, i) => chapter(200 + i + 1)); // short page → stop

    // A hand-rolled fetch (not the fetchFrom(map) helper) keyed on the `page` query param via
    // URL parsing — a substring/exact-string key would collide with `per_page=200` sharing the
    // digits `200` and the literal text `page=`.
    const fetch: FetchImpl = async (u) => {
      const page = new URL(u).searchParams.get('page');
      if (page === '1') return okRes(JSON.stringify(page1));
      if (page === '2') return okRes(JSON.stringify(page2));
      return { outcome: 'HTTP_4XX', status: 404 } as PoliteResult;
    };

    await pollAllSources(fetch, undefined, new Date('2026-07-29T12:00:00Z'));

    const stored = await db.chapter.findMany({ where: { seriesId: series.id } });
    expect(stored).toHaveLength(218);
    // Spot-check a page-2-only chapter actually made it in, not just 200 from page 1 padded out.
    expect(stored.some((c) => c.url === 'https://api.example/read/218')).toBe(true);
  });

  test('WP-45b/WP-20: a paginated API source observes a chapter unlock after a later poll', async () => {
    // A tiny (perPage: 2) paginated fixture, mirroring the WP-45/WP-20 unlock test but proving
    // the LOCKED→FREE persistence still fires when the chapter that unlocks lives on a page that
    // pagination had to fetch + union — not just a single-page body.
    const apiUrl = 'https://api.example/works/2/chapters?per_page=2';
    const c1 = 'https://api.example/read/c1';
    const c2 = 'https://api.example/read/c2';
    const c3 = 'https://api.example/read/c3';
    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Epsilon',
        sources: { create: { url: 'https://api.example/series/epsilon', host: 'api.example', type: 'FEED', feedUrl: 'https://api.example/feed/' } },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0]!.id;
    await setApiDescriptor(sourceId, {
      endpoint: apiUrl,
      map: {
        urlField: 'url',
        titleField: 'title',
        isFreeField: 'locked',
        isFreeWhen: 'falsy',
        pagination: { pageParam: 'page', perPage: 2 },
      },
    });

    // Poll 1: page 1 is FULL (2 items, c1 LOCKED) → keep paging; page 2 is SHORT (1 item) → stop.
    const fetchLocked: FetchImpl = async (u) => {
      const page = new URL(u).searchParams.get('page');
      if (page === '1') {
        return okRes(
          JSON.stringify([
            { url: c1, title: 'Ch 1', locked: true },
            { url: c2, title: 'Ch 2', locked: false },
          ]),
        );
      }
      if (page === '2') return okRes(JSON.stringify([{ url: c3, title: 'Ch 3', locked: false }]));
      return { outcome: 'HTTP_4XX', status: 404 } as PoliteResult;
    };
    const t0 = new Date('2026-07-29T12:00:00Z');
    await pollAllSources(fetchLocked, undefined, t0);

    const stored1 = await db.chapter.findMany({ where: { seriesId: series.id } });
    expect(stored1).toHaveLength(3);
    const locked = stored1.find((c) => c.url === c1)!;
    expect(locked.access).toBe('LOCKED');
    expect(locked.becameFreeAt).toBeNull();

    // Poll 2, past the host min-poll-interval floor: page 1 now reports c1 unlocked. The real
    // poll must union pages AND fire the WP-20 unlock diff on a chapter that came from page 1
    // (not just a single-page body), persisted end-to-end through the real DB.
    const fetchUnlocked: FetchImpl = async (u) => {
      const page = new URL(u).searchParams.get('page');
      if (page === '1') {
        return okRes(
          JSON.stringify([
            { url: c1, title: 'Ch 1', locked: false },
            { url: c2, title: 'Ch 2', locked: false },
          ]),
        );
      }
      if (page === '2') return okRes(JSON.stringify([{ url: c3, title: 'Ch 3', locked: false }]));
      return { outcome: 'HTTP_4XX', status: 404 } as PoliteResult;
    };
    const t1 = new Date(t0.getTime() + 20 * 60_000); // 20 min later, past the 15-min floor
    const effects = await pollAllSources(fetchUnlocked, undefined, t1);
    expect(effects[0]!.becameFree.map((c) => c.url)).toEqual([c1]);

    const stored2 = await db.chapter.findMany({ where: { seriesId: series.id } });
    expect(stored2).toHaveLength(3); // still unioned across pages, not re-created
    const unlocked = stored2.find((c) => c.url === c1)!;
    expect(unlocked.access).toBe('FREE');
    expect(unlocked.becameFreeAt).not.toBeNull();
  });
});

describe('reclassifySource (real DB, WP-34)', () => {
  test('WP-34: reclassifySource flips a FEED source to PAGE_WATCH (render → fetchMode RENDER)', async () => {
    const url = 'https://paid.example/novel/z/';
    const feedUrl = 'https://paid.example/feed/';
    const { seriesId } = await created(addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS(ITEM('g1', 'https://paid.example/z-1/'))) }),
    ));
    const before = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(before.type).toBe('FEED');

    const res = await reclassifySource(before.id, { render: true });
    expect(res.updated).toBe(true);

    const after = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(after.type).toBe('PAGE_WATCH');
    expect(after.feedUrl).toBeNull();
    expect(after.matchType).toBe('WHOLE_FEED');
    expect(after.matchValue).toBeNull();
    expect(after.fetchMode).toBe('RENDER');
  });

  test('WP-34: reclassifySource without render keeps fetchMode PLAIN', async () => {
    const url = 'https://free.example/novel/w/';
    const feedUrl = 'https://free.example/feed/';
    const { seriesId } = await created(addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS(ITEM('g1', 'https://free.example/w-1/'))) }),
    ));
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });

    await reclassifySource(src.id);

    const after = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(after.type).toBe('PAGE_WATCH');
    expect(after.fetchMode).toBe('PLAIN');
  });

  test('WP-34: reclassifySource without render does not reset an already-RENDER source to PLAIN (one-way ratchet)', async () => {
    const url = 'https://ratchet.example/novel/q/';
    const feedUrl = 'https://ratchet.example/feed/';
    const { seriesId } = await created(addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS(ITEM('g1', 'https://ratchet.example/q-1/'))) }),
    ));
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });
    await db.source.update({ where: { id: src.id }, data: { fetchMode: 'RENDER' } });

    await reclassifySource(src.id);

    const after = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(after.type).toBe('PAGE_WATCH');
    expect(after.fetchMode).toBe('RENDER'); // untouched, not forced back to PLAIN
  });

  test('WP-34: switchToPageWatch flips FEED→PAGE_WATCH and render-seeds a CF TOC silently', async () => {
    const url = 'https://paid.example/novel/q/';
    const feedUrl = 'https://paid.example/feed/';
    // Add as FEED with an EMPTY feed window → 0 chapters seeded (clean baseline for the switch).
    const { seriesId } = await created(addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS('')) }),
    ));

    // Plain fetch of the TOC fails (CF-blocked); render returns the real TOC.
    const plain = fetchFrom({}); // everything 404 → backfill reads nothing
    const rendered = fetchFrom({
      [url]: okRes(`<html><body><ul>
        <li><a href="https://paid.example/novel/q/ch-1/">Chapter 1</a></li>
        <li class="premium"><a href="https://paid.example/novel/q/ch-2/">Chapter 2</a></li>
      </ul></body></html>`),
    });

    const res = await switchToPageWatch(seriesId, { fetchImpl: plain, renderImpl: rendered });

    expect(res.ok).toBe(true);
    expect(res.rendered).toBe(true);
    expect(res.fetchMode).toBe('RENDER');
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(src.type).toBe('PAGE_WATCH');
    expect(src.fetchMode).toBe('RENDER');
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([
      'https://paid.example/novel/q/ch-1/',
      'https://paid.example/novel/q/ch-2/',
    ]);
    expect(chapters.find((c) => c.url.endsWith('ch-2/'))!.access).toBe('LOCKED');
  });

  test('WP-34: switchToPageWatch with a plain-readable TOC stays PLAIN (no render)', async () => {
    const url = 'https://free.example/novel/r/';
    const feedUrl = 'https://free.example/feed/';
    const { seriesId } = await created(addSeries(
      { url },
      fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS('')) }),
    ));
    const plain = fetchFrom({
      [url]: okRes(`<html><body><ul><li><a href="https://free.example/novel/r/ch-1/">Chapter 1</a></li></ul></body></html>`),
    });

    const res = await switchToPageWatch(seriesId, { fetchImpl: plain, renderImpl: fetchFrom({}) });

    expect(res.rendered).toBe(false);
    expect(res.fetchMode).toBe('PLAIN');
    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('PLAIN');
  });

  test('WP-34: switchToPageWatch reports the source actual fetchMode (a pre-RENDER source stays/reports RENDER)', async () => {
    const url = 'https://free.example/novel/s/';
    const feedUrl = 'https://free.example/feed/';
    const { seriesId } = await created(addSeries({ url }, fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS('')) })));
    await db.source.updateMany({ where: { seriesId }, data: { fetchMode: 'RENDER' } }); // simulate a prior escalation
    const plain = fetchFrom({ [url]: okRes(`<html><body><ul><li><a href="https://free.example/novel/s/ch-1/">Chapter 1</a></li></ul></body></html>`) });

    const res = await switchToPageWatch(seriesId, { fetchImpl: plain, renderImpl: fetchFrom({}) });

    expect(res.rendered).toBe(false);       // plain succeeded → no escalation this switch
    expect(res.fetchMode).toBe('RENDER');   // reports the actual persisted mode (ratchet kept RENDER)
    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('RENDER');
  });
});

describe('backfillWithEscalation (real DB, WP-34)', () => {
  const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
  const ROW = (url: string, locked = false) =>
    `<li${locked ? ' class="premium"' : ''}><a href="${url}">Chapter</a></li>`;

  test('PAGE_WATCH CF series: plain reads nothing, render seeds the TOC → rendered:true, fetchMode RENDER', async () => {
    const url = 'https://cfsite.example/novel/omega/';
    // No feed, no readable chapter list, no discoverable TOC link → under WP-50 this page has
    // nothing to resolve at add-time and would need user confirmation. This test isn't about
    // add-time resolution, just a clean 0-chapter PLAIN PAGE_WATCH baseline for backfillWithEscalation
    // to render-recover from — seed it directly via allowLinkOnly instead of a fetch fixture.
    const { seriesId } = await created(addSeries({ url, allowLinkOnly: true }, fetchFrom({})));
    const before = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(before.type).toBe('PAGE_WATCH');
    expect(before.fetchMode).toBe('PLAIN');

    const plain = fetchFrom({}); // TOC url 404s → plain backfill reads nothing
    const rendered = fetchFrom({
      [url]: okRes(TOC(ROW('https://cfsite.example/novel/omega/ch-1/') + ROW('https://cfsite.example/novel/omega/ch-2/', true))),
    });

    const res = await backfillWithEscalation(seriesId, { fetchImpl: plain, renderImpl: rendered });

    expect(res.rendered).toBe(true);
    expect(res.added).toBe(2);
    expect(res.reconciled).toBe(0);
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters).toHaveLength(2);
    expect(chapters.find((c) => c.url.endsWith('ch-2/'))!.access).toBe('LOCKED');
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(src.fetchMode).toBe('RENDER');
  });

  test('FEED series: plain fails, render seeds → rendered:true, chapters seeded, fetchMode stays PLAIN (not flipped)', async () => {
    const url = 'https://feedsite.example/novel/beta/';
    const feedUrl = 'https://feedsite.example/feed/';
    const { seriesId } = await created(addSeries({ url }, fetchFrom({ [url]: okRes(PAGE(feedUrl)), [feedUrl]: okRes(RSS('')) })));
    const before = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(before.type).toBe('FEED');
    expect(before.fetchMode).toBe('PLAIN');

    const plain = fetchFrom({}); // TOC url (= source.url) 404s → plain backfill reads nothing
    const rendered = fetchFrom({
      [url]: okRes(TOC(ROW('https://feedsite.example/novel/beta/ch-1/') + ROW('https://feedsite.example/novel/beta/ch-2/'))),
    });

    const res = await backfillWithEscalation(seriesId, { fetchImpl: plain, renderImpl: rendered });

    expect(res.rendered).toBe(true);
    expect(res.added).toBe(2);
    const chapters = await db.chapter.findMany({ where: { seriesId } });
    expect(chapters).toHaveLength(2);
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(src.type).toBe('FEED'); // untouched
    expect(src.fetchMode).toBe('PLAIN'); // a FEED source is NOT flipped to RENDER
  });

  test('plain-readable series: plain reads the TOC → rendered:false, no fetchMode change', async () => {
    const url = 'https://plainsite.example/novel/gamma/';
    // Same reasoning as above: a clean 0-chapter PLAIN PAGE_WATCH baseline, seeded directly.
    const { seriesId } = await created(addSeries({ url, allowLinkOnly: true }, fetchFrom({})));
    const before = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(before.type).toBe('PAGE_WATCH');

    const plain = fetchFrom({ [url]: okRes(TOC(ROW('https://plainsite.example/novel/gamma/ch-1/'))) });
    const res = await backfillWithEscalation(seriesId, { fetchImpl: plain, renderImpl: fetchFrom({}) });

    expect(res.rendered).toBe(false);
    expect(res.added).toBe(1);
    const src = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(src.fetchMode).toBe('PLAIN');
  });
});

describe('getFeed (real DB)', () => {
  test('new-chapter + now-free for READING series; excludes locked + non-reading; a formerly-locked chapter notifies once', async () => {
    const userId = getCurrentUserId();
    const now = new Date('2026-08-30T12:00:00Z');
    const recent = new Date('2026-08-30T06:00:00Z');
    const older = new Date('2026-08-29T06:00:00Z');

    await db.series.create({
      data: {
        userId,
        title: 'Reading One',
        status: 'READING',
        chapters: {
          create: [
            { title: 'free-recent', url: 'https://ex.test/r/2', access: 'FREE', discoveredAt: recent, announcedAt: recent },
            { title: 'free-older', url: 'https://ex.test/r/1', access: 'FREE', discoveredAt: older, announcedAt: older },
            { title: 'locked', url: 'https://ex.test/r/3', access: 'LOCKED', discoveredAt: recent },
            // Discovered locked, now unlocked → access FREE + becameFreeAt set (NOW_FREE, not new-chapter).
            { title: 'unlocked', url: 'https://ex.test/r/4', access: 'FREE', discoveredAt: older, becameFreeAt: recent },
          ],
        },
      },
    });
    await db.series.create({
      data: {
        userId,
        title: 'Completed One',
        status: 'COMPLETED',
        chapters: { create: [{ title: 'done', url: 'https://ex.test/c/1', access: 'FREE', discoveredAt: recent }] },
      },
    });

    const feed = await getFeed(now);
    const items = feed.groups.flatMap((g) => g.items);
    const titles = items.map((i) => i.chapterTitle);

    // The formerly-locked chapter surfaces exactly once, as NOW_FREE (no double-notify).
    const unlocked = items.filter((i) => i.chapterTitle === 'unlocked');
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]!.kind).toBe('NOW_FREE');

    // Readable-from-the-start chapters are NEW_CHAPTER; still-locked + non-reading excluded.
    expect(items.find((i) => i.chapterTitle === 'free-recent')?.kind).toBe('NEW_CHAPTER');
    expect(titles).toContain('free-older');
    expect(titles).not.toContain('locked');
    expect(titles).not.toContain('done');
    expect(feed.groups[0]!.label).toBe('Today');
  });

  test('computes the read flag from reading progress (chapters at/before the pointer are read)', async () => {
    const userId = getCurrentUserId();
    const at = new Date('2026-08-30T06:00:00Z');
    const series = await db.series.create({
      data: {
        userId,
        title: 'Progress Series',
        status: 'READING',
        chapters: {
          create: [
            { title: 'prog-read', url: 'https://ex.test/prog/1', access: 'FREE', number: 1, discoveredAt: at, announcedAt: at },
            { title: 'prog-unread', url: 'https://ex.test/prog/2', access: 'FREE', number: 2, discoveredAt: at, announcedAt: at },
          ],
        },
      },
      include: { chapters: true },
    });
    const first = series.chapters.find((c) => c.title === 'prog-read')!;
    await db.readingProgress.create({ data: { userId, seriesId: series.id, lastReadChapterId: first.id } });

    const items = (await getFeed(new Date('2026-08-30T12:00:00Z'))).groups.flatMap((g) => g.items);
    expect(items.find((i) => i.chapterTitle === 'prog-read')?.read).toBe(true); // at/before the pointer
    expect(items.find((i) => i.chapterTitle === 'prog-unread')?.read).toBe(false); // after the pointer
  });

  test('shows only poll-discovered chapters (announcedAt); never add/backfill imports', async () => {
    const userId = getCurrentUserId();
    const at = new Date('2026-08-30T06:00:00Z');
    await db.series.create({
      data: {
        userId,
        title: 'Fresh Import',
        status: 'READING',
        chapters: {
          create: [
            // A bulk import (add/backfill) leaves announcedAt null — must NOT flood the feed.
            { title: 'imported', url: 'https://ex.test/imp/1', access: 'FREE', discoveredAt: at },
            // A poll-discovered arrival carries announcedAt — this is what the feed shows.
            { title: 'announced', url: 'https://ex.test/imp/2', access: 'FREE', discoveredAt: at, announcedAt: at },
          ],
        },
      },
    });
    const titles = (await getFeed(new Date('2026-08-30T12:00:00Z'))).groups.flatMap((g) => g.items.map((i) => i.chapterTitle));
    expect(titles).toContain('announced');
    expect(titles).not.toContain('imported'); // the import does not flood the feed
  });

  test('surfaces a LIKELY_DOWN source of a READING series as an attention row', async () => {
    const userId = getCurrentUserId();
    await db.series.create({
      data: {
        userId,
        title: 'Down Series',
        status: 'READING',
        sources: {
          create: {
            url: 'https://down.test/novel/',
            host: 'down.test',
            type: 'PAGE_WATCH',
            health: 'LIKELY_DOWN',
          },
        },
      },
    });
    const feed = await getFeed(new Date('2026-08-30T12:00:00Z'));
    expect(feed.attention.some((a) => a.host === 'down.test' && a.seriesTitle === 'Down Series')).toBe(true);
  });

  test('surfaces down sources for still-active statuses; excludes Completed + Dropped', async () => {
    const userId = getCurrentUserId();
    const downSeries = (title: string, status: 'PAUSED' | 'PLANNED' | 'COMPLETED' | 'DROPPED') =>
      db.series.create({
        data: {
          userId,
          title,
          status,
          sources: { create: { url: `https://${title}.test/novel/`, host: `${title}.test`, type: 'PAGE_WATCH', health: 'LIKELY_DOWN' } },
        },
      });
    await downSeries('paused', 'PAUSED');
    await downSeries('planned', 'PLANNED');
    await downSeries('completed', 'COMPLETED');
    await downSeries('dropped', 'DROPPED');

    const hosts = (await getFeed(new Date('2026-08-30T12:00:00Z'))).attention.map((a) => a.host);
    expect(hosts).toContain('paused.test'); // still-active → a down source is actionable
    expect(hosts).toContain('planned.test');
    expect(hosts).not.toContain('completed.test'); // finished works don't need new chapters
    expect(hosts).not.toContain('dropped.test'); // dropped on purpose
  });

  test('does not surface a link-only or healthy source', async () => {
    const userId = getCurrentUserId();
    await db.series.create({
      data: {
        userId,
        title: 'Link Only Down',
        status: 'READING',
        sources: { create: { url: 'https://lo.test/novel/', host: 'lo.test', type: 'PAGE_WATCH', health: 'LIKELY_DOWN', linkOnly: true } },
      },
    });
    await db.series.create({
      data: {
        userId,
        title: 'Healthy',
        status: 'READING',
        sources: { create: { url: 'https://ok.test/novel/', host: 'ok.test', type: 'PAGE_WATCH', health: 'HEALTHY' } },
      },
    });
    const hosts = (await getFeed(new Date('2026-08-30T12:00:00Z'))).attention.map((a) => a.host);
    expect(hosts).not.toContain('lo.test'); // link-only → no health alert (matches the shelf dot gating)
    expect(hosts).not.toContain('ok.test'); // healthy → not down
  });
});
