import { describe, expect, test } from 'vitest';
import {
  addSeries,
  pruneChapters,
  deleteSeries,
  resetChapters,
  setSourceUrl,
  mergeSeries,
  listSeriesForCleanup,
  setApiDescriptor,
  type FetchImpl,
} from '../../src/server/services';
import { db } from '../../src/server/db';
import { getCurrentUserId } from '../../src/server/user';
import type { PoliteResult } from '../../src/lib/feeds/fetch';

// ── fixtures (mirrors tests/integration/services.test.ts) ────────────────────
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

/** Add the "Alpha" series (page → feed with 2 chapters, guids g1/g2) and return its id. */
async function addAlpha(): Promise<string> {
  const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
  const result = await addSeries({ url: PAGE_URL }, fetch);
  // WP-50: addSeries now returns a `kind`-discriminated union; this fixture always exercises the
  // create path (a page + feed that resolve cleanly), so narrow once here.
  if (result.kind !== 'created') throw new Error('expected created');
  return result.seriesId;
}

/** A second "Alpha" series row with identical content — simulates a pre-existing duplicate
 *  (e.g. from before WP-39, or a race) for mergeSeries to clean up. Created directly via
 *  `db` because add-time dedup (WP-39) now collapses a second `addAlpha()` call into the
 *  same row instead of creating a duplicate. */
async function addAlphaDuplicate(): Promise<string> {
  const series = await db.series.create({
    data: {
      userId: getCurrentUserId(),
      title: 'Alpha',
      canonicalId: 'translator.example/feed#WHOLE_FEED',
      sources: {
        create: { url: PAGE_URL, host: 'translator.example', type: 'FEED', feedUrl: FEED_URL, matchType: 'WHOLE_FEED', matchValue: null },
      },
      chapters: {
        create: [
          { title: 'Chapter g1', url: C1, guid: 'g1', access: 'UNKNOWN' },
          { title: 'Chapter g2', url: C2, guid: 'g2', access: 'UNKNOWN' },
        ],
      },
    },
  });
  return series.id;
}

// ── tests ───────────────────────────────────────────────────────────────────
describe('pruneChapters (real DB)', () => {
  test('deletes exactly the given chapters and leaves the rest of the series intact', async () => {
    const seriesId = await addAlpha();
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    const [c1] = chapters;

    const result = await pruneChapters([c1!.id]);
    expect(result).toEqual({ deleted: 1 });

    const remaining = await db.chapter.findMany({ where: { seriesId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).not.toBe(c1!.id);
  });

  test('only deletes chapters belonging to the current user (scoped via series ownership)', async () => {
    const seriesId = await addAlpha();
    const chapters = await db.chapter.findMany({ where: { seriesId } });

    // A chapter on someone else's series is untouched even if its id is passed.
    const otherSeries = await db.series.create({ data: { userId: 'someone-else', title: 'Other' } });
    const otherChapter = await db.chapter.create({
      data: { seriesId: otherSeries.id, title: 'Foreign', url: 'https://other.example/c1' },
    });

    const result = await pruneChapters([otherChapter.id]);
    expect(result).toEqual({ deleted: 0 });
    expect(await db.chapter.findUnique({ where: { id: otherChapter.id } })).not.toBeNull();
    expect(await db.chapter.count({ where: { seriesId } })).toBe(chapters.length);
  });
});

describe('deleteSeries (real DB)', () => {
  test('removes the series and cascades its chapters and sources', async () => {
    const seriesId = await addAlpha();

    const result = await deleteSeries(seriesId);
    expect(result).toEqual({ deleted: true });

    expect(await db.series.findUnique({ where: { id: seriesId } })).toBeNull();
    expect(await db.chapter.count({ where: { seriesId } })).toBe(0);
    expect(await db.source.count({ where: { seriesId } })).toBe(0);
  });

  test('returns deleted: false for a series that is not the current user’s', async () => {
    const otherSeries = await db.series.create({ data: { userId: 'someone-else', title: 'Other' } });
    const result = await deleteSeries(otherSeries.id);
    expect(result).toEqual({ deleted: false });
    expect(await db.series.findUnique({ where: { id: otherSeries.id } })).not.toBeNull();
  });
});

describe('resetChapters (real DB)', () => {
  test('empties a series’ chapters; the series row remains', async () => {
    const seriesId = await addAlpha();

    const result = await resetChapters(seriesId);
    expect(result).toEqual({ deleted: 2 });

    expect(await db.chapter.count({ where: { seriesId } })).toBe(0);
    expect(await db.series.findUnique({ where: { id: seriesId } })).not.toBeNull();
  });

  test('is a no-op for a series that is not the current user’s', async () => {
    const otherSeries = await db.series.create({ data: { userId: 'someone-else', title: 'Other' } });
    const otherChapter = await db.chapter.create({
      data: { seriesId: otherSeries.id, title: 'Foreign', url: 'https://other.example/c1' },
    });

    const result = await resetChapters(otherSeries.id);
    expect(result).toEqual({ deleted: 0 });

    expect(await db.chapter.findUnique({ where: { id: otherChapter.id } })).not.toBeNull();
    expect(await db.chapter.count({ where: { seriesId: otherSeries.id } })).toBe(1);
  });
});

describe('setSourceUrl (real DB)', () => {
  test('updates the source’s url only', async () => {
    const seriesId = await addAlpha();
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const newUrl = 'https://translator.example/novel/alpha-moved/';

    const result = await setSourceUrl(source.id, newUrl);
    expect(result).toEqual({ updated: true });

    const updated = await db.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(updated.url).toBe(newUrl);
    expect(updated.host).toBe(source.host); // only url changes
    expect(updated.feedUrl).toBe(source.feedUrl);
  });

  test('updates host too when the new url is on a different domain', async () => {
    const seriesId = await addAlpha();
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const newUrl = 'https://new-host.example/novel/alpha/';

    const result = await setSourceUrl(source.id, newUrl);
    expect(result).toEqual({ updated: true });

    const updated = await db.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(updated.url).toBe(newUrl);
    expect(updated.host).toBe('new-host.example');
  });

  test('returns updated: false for a source not owned by the current user', async () => {
    const otherSeries = await db.series.create({ data: { userId: 'someone-else', title: 'Other' } });
    const otherSource = await db.source.create({
      data: { seriesId: otherSeries.id, url: 'https://other.example/', host: 'other.example' },
    });

    const result = await setSourceUrl(otherSource.id, 'https://other.example/new');
    expect(result).toEqual({ updated: false });
  });
});

describe('setApiDescriptor (real DB)', () => {
  // WP-54: flipping a link-only source (WP-50) to a working API must un-gate it, or the poll
  // (which selects linkOnly:false) would keep skipping it after the flip.
  test('un-gates a link-only source when flipping it to API', async () => {
    const series = await db.series.create({
      data: {
        userId: getCurrentUserId(),
        title: 'Beta',
        sources: {
          create: { url: 'https://translator.example/novel/beta', host: 'translator.example', type: 'PAGE_WATCH', linkOnly: true },
        },
      },
      include: { sources: true },
    });
    const sourceId = series.sources[0]!.id;

    const result = await setApiDescriptor(sourceId, {
      endpoint: 'https://translator.example/api/chapters?slug=beta',
      map: { urlTemplate: '/novel/beta/{order}', titleField: 'title', numberField: 'order', listPath: 'data' },
    });
    expect(result).toEqual({ updated: true });

    const updated = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(updated.type).toBe('API');
    expect(updated.linkOnly).toBe(false); // un-gated → now pollable
    expect(updated.isActive).toBe(true);
    expect(updated.apiUrl).toBe('https://translator.example/api/chapters?slug=beta');
  });
});

describe('mergeSeries (real DB)', () => {
  test('folds unique chapters into `into` and deletes the source series', async () => {
    const intoId = await addAlpha(); // chapters a-1, a-2
    const fromId = await addAlphaDuplicate(); // a second copy (a-1, a-2) + a unique a-9
    await db.chapter.create({ data: { seriesId: fromId, title: 'C9', url: 'https://translator.example/a-9/' } });

    const res = await mergeSeries(fromId, intoId);
    expect(res).toEqual({ movedChapters: 1, deleted: true }); // only a-9 was unique

    expect(await db.series.findUnique({ where: { id: fromId } })).toBeNull();
    const intoUrls = (await db.chapter.findMany({ where: { seriesId: intoId } })).map((c) => c.url).sort();
    expect(intoUrls).toEqual([C1, C2, 'https://translator.example/a-9/'].sort());

    // The moved chapter's sourceId now points at `into`'s active source (or null), never `from`'s
    // (deleted) source — Chapter.sourceId is onDelete: SetNull so a stale pointer would just go
    // null, but we want it actively re-attached to into's source when one exists.
    const intoSource = await db.source.findFirstOrThrow({ where: { seriesId: intoId, isActive: true } });
    const moved = await db.chapter.findFirstOrThrow({ where: { seriesId: intoId, url: 'https://translator.example/a-9/' } });
    expect(moved.sourceId).toBe(intoSource.id);

    // from's duplicate chapters and source are gone (cascaded).
    expect(await db.source.count({ where: { seriesId: fromId } })).toBe(0);
  });

  test('into adopts from’s reading progress only when into had none', async () => {
    const intoId = await addAlpha();
    const fromId = await addAlphaDuplicate();
    const fromChapters = await db.chapter.findMany({ where: { seriesId: fromId }, orderBy: { url: 'asc' } });

    await db.readingProgress.create({
      data: { userId: 'local', seriesId: fromId, lastReadChapterId: fromChapters[0]!.id },
    });

    await mergeSeries(fromId, intoId);

    const progress = await db.readingProgress.findUnique({ where: { seriesId: intoId } });
    expect(progress).not.toBeNull();
    // fromChapters[0] (a-1) is a duplicate of into's a-1 and was NOT moved (dropped with from),
    // so the stale pointer must not carry over — lastReadChapterId falls back to null.
    expect(progress!.lastReadChapterId).toBeNull();
  });

  test('does not overwrite into’s existing reading progress', async () => {
    const intoId = await addAlpha();
    const fromId = await addAlphaDuplicate();
    const intoChapters = await db.chapter.findMany({ where: { seriesId: intoId }, orderBy: { url: 'asc' } });
    const fromChapters = await db.chapter.findMany({ where: { seriesId: fromId }, orderBy: { url: 'asc' } });

    await db.readingProgress.create({
      data: { userId: 'local', seriesId: intoId, lastReadChapterId: intoChapters[0]!.id },
    });
    await db.readingProgress.create({
      data: { userId: 'local', seriesId: fromId, lastReadChapterId: fromChapters[1]!.id },
    });

    await mergeSeries(fromId, intoId);

    const progress = await db.readingProgress.findUniqueOrThrow({ where: { seriesId: intoId } });
    expect(progress.lastReadChapterId).toBe(intoChapters[0]!.id); // unchanged
  });

  test('only merges series belonging to the current user', async () => {
    const intoId = await addAlpha();
    const otherSeries = await db.series.create({ data: { userId: 'someone-else', title: 'Other' } });

    await expect(mergeSeries(otherSeries.id, intoId)).rejects.toBeTruthy();
    expect(await db.series.findUnique({ where: { id: otherSeries.id } })).not.toBeNull();
  });

  test('rejects a self-merge instead of silently deleting the series', async () => {
    const seriesId = await addAlpha();

    await expect(mergeSeries(seriesId, seriesId)).rejects.toThrow();

    expect(await db.series.findUnique({ where: { id: seriesId } })).not.toBeNull();
    expect(await db.chapter.count({ where: { seriesId } })).toBe(2);
  });
});

describe('listSeriesForCleanup (real DB)', () => {
  test('returns the series with chapters (id/number/title/url) and sources (id/type/url/feedUrl)', async () => {
    const seriesId = await addAlpha();

    const result = await listSeriesForCleanup(seriesId);
    expect(result).not.toBeNull();
    expect(result!.chapters.map((c) => c.url).sort()).toEqual([C1, C2]);
    expect(result!.chapters[0]).toHaveProperty('id');
    expect(result!.chapters[0]).toHaveProperty('number');
    expect(result!.chapters[0]).toHaveProperty('title');
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0]).toMatchObject({ type: 'FEED', feedUrl: FEED_URL });
    expect(result!.sources[0]).toHaveProperty('id');
    expect(result!.sources[0]).toHaveProperty('url');
  });

  test('returns null for a series that is not the current user’s', async () => {
    const otherSeries = await db.series.create({ data: { userId: 'someone-else', title: 'Other' } });
    expect(await listSeriesForCleanup(otherSeries.id)).toBeNull();
  });
});
