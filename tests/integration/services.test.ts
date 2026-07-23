import { describe, expect, test } from 'vitest';
import {
  addSeries,
  pollAllSources,
  listSeries,
  updateSeries,
  savePushSubscription,
  type FetchImpl,
} from '../../src/server/services';
import { db } from '../../src/server/db';
import type { PoliteResult } from '../../src/lib/feeds/fetch';

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

const PAGE_URL = 'https://translator.example/novel/alpha/';
const FEED_URL = 'https://translator.example/feed/';
const C1 = 'https://translator.example/a-1/';
const C2 = 'https://translator.example/a-2/';
const C3 = 'https://translator.example/a-3/';

/** Add the "Alpha" series (page → feed with 2 chapters) and return its id. */
async function addAlpha(): Promise<string> {
  const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
  const { seriesId } = await addSeries({ url: PAGE_URL }, fetch);
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
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetch);

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
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetch);

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
