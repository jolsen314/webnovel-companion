import type { Prisma } from '@prisma/client';
import { db } from '../db';
import { getCurrentUserId } from '../user';
import { chaptersToMove } from '../../lib/chapters/merge';
import type { ApiDescriptor } from '../../lib/feeds/apiAdapter';
import { ownsSeries, ownsSource } from './ownership';

/**
 * User-scoped recovery services for a contaminated series (WP-38): a mis-matched feed
 * category, a stray page-watch, or a translator site move that produced duplicate rows.
 * Every op verifies ownership via the series (or the series a chapter/source belongs to)
 * before touching anything. Thin Prisma glue; integration-tested against a real DB.
 */

/** Delete specific chapters, scoped to the current user's series. */
export async function pruneChapters(chapterIds: string[]): Promise<{ deleted: number }> {
  if (chapterIds.length === 0) return { deleted: 0 };
  const userId = getCurrentUserId();
  const { count } = await db.chapter.deleteMany({
    where: { id: { in: chapterIds }, series: { userId } },
  });
  return { deleted: count };
}

/** Delete an entire series (cascades its chapters, sources, and reading progress). */
export async function deleteSeries(seriesId: string): Promise<{ deleted: boolean }> {
  if (!(await ownsSeries(seriesId))) return { deleted: false };
  await db.series.delete({ where: { id: seriesId } });
  return { deleted: true };
}

/** Empty a series' chapters (e.g. to force a clean re-seed on next poll). The series row stays. */
export async function resetChapters(seriesId: string): Promise<{ deleted: number }> {
  const userId = getCurrentUserId();
  const { count } = await db.chapter.deleteMany({ where: { seriesId, series: { userId } } });
  return { deleted: count };
}

/**
 * Repoint a source's reading-page url (e.g. after a translator site move). `host` is
 * re-derived from the new url so host-level health aggregation (`@@index([host])`)
 * doesn't roll a cross-domain move up under the stale host; an unparseable url leaves
 * `host` untouched.
 */
export async function setSourceUrl(sourceId: string, url: string): Promise<{ updated: boolean }> {
  if (!(await ownsSource(sourceId))) return { updated: false };
  let host: string | undefined;
  try {
    host = new URL(url).host;
  } catch {
    host = undefined;
  }
  await db.source.update({ where: { id: sourceId }, data: { url, ...(host !== undefined ? { host } : {}) } });
  return { updated: true };
}

/** Flip an owned source FEED→PAGE_WATCH: deactivate the feed, drop the series matcher, and
 *  (when `render`) set RENDER — for CF/JS TOCs the plain fetch can't read (WP-34). */
export async function reclassifySource(
  sourceId: string,
  opts: { render?: boolean } = {},
): Promise<{ updated: boolean }> {
  if (!(await ownsSource(sourceId))) return { updated: false };
  await db.source.update({
    where: { id: sourceId },
    data: {
      type: 'PAGE_WATCH',
      feedUrl: null,
      matchType: 'WHOLE_FEED',
      matchValue: null,
      ...(opts.render ? { fetchMode: 'RENDER' as const } : {}),
    },
  });
  return { updated: true };
}

/** WP-45: point an owned source at a chapter data API — set type=API, the endpoint, and the
 *  field descriptor; drop the now-irrelevant feed matcher + stale validators. `render` marks a
 *  CF-gated API that must be fetched through the headless browser (WP-45b). Pointing a source at a
 *  working API makes it trackable, so a link-only source (WP-50) is un-gated (`linkOnly:false`,
 *  `isActive:true`) here — otherwise the poll, which selects `linkOnly:false` sources, would keep
 *  skipping it after the flip. */
export async function setApiDescriptor(
  sourceId: string,
  opts: { endpoint: string; map: ApiDescriptor; render?: boolean },
): Promise<{ updated: boolean }> {
  if (!(await ownsSource(sourceId))) return { updated: false };
  await db.source.update({
    where: { id: sourceId },
    data: {
      type: 'API',
      apiUrl: opts.endpoint,
      apiMap: opts.map as unknown as Prisma.InputJsonValue,
      feedUrl: null,
      matchType: 'WHOLE_FEED',
      matchValue: null,
      etag: null,
      lastModified: null,
      linkOnly: false,
      isActive: true,
      fetchMode: opts.render ? 'RENDER' : 'PLAIN',
    },
  });
  return { updated: true };
}

/** WP-54: the owned source's page URL to render for an API probe (or null if not the user's). */
export async function getSourceForProbe(sourceId: string): Promise<{ url: string; type: string } | null> {
  if (!(await ownsSource(sourceId))) return null;
  const source = await db.source.findUnique({ where: { id: sourceId }, select: { url: true, type: true } });
  return source ? { url: source.url, type: source.type } : null;
}

/**
 * Fold a duplicate series (`from`) into the correct one (`into`): unique chapters (by
 * canonical URL) move over, duplicates are dropped with `from`, and `from` is deleted —
 * cascading its remaining chapters/sources/progress. `into` adopts `from`'s reading
 * progress only if it had none of its own; a moved-away lastReadChapterId falls back to
 * null rather than pointing at a row that no longer exists.
 *
 * `into` should have an active source — otherwise moved chapters land with
 * `sourceId: null` and the merged series has nothing to poll.
 */
export async function mergeSeries(fromId: string, intoId: string): Promise<{ movedChapters: number; deleted: boolean }> {
  if (fromId === intoId) throw new Error('mergeSeries: cannot merge a series into itself');
  const userId = getCurrentUserId();
  const [from, into] = await Promise.all([
    db.series.findFirst({ where: { id: fromId, userId }, select: { id: true } }),
    db.series.findFirst({ where: { id: intoId, userId }, select: { id: true } }),
  ]);
  if (!from || !into) throw new Error('mergeSeries: both series must belong to the current user');

  const [fromChapters, intoChapters, intoActiveSource, intoProgress, fromProgress] = await Promise.all([
    db.chapter.findMany({ where: { seriesId: fromId }, select: { id: true, url: true } }),
    db.chapter.findMany({ where: { seriesId: intoId }, select: { url: true } }),
    db.source.findFirst({ where: { seriesId: intoId, isActive: true }, select: { id: true } }),
    db.readingProgress.findUnique({ where: { seriesId: intoId } }),
    db.readingProgress.findUnique({ where: { seriesId: fromId } }),
  ]);

  const toMove = chaptersToMove(fromChapters, intoChapters.map((c) => c.url));
  const movedIds = new Set(toMove.map((c) => c.id));

  const ops = [];
  if (toMove.length > 0) {
    ops.push(
      db.chapter.updateMany({
        where: { id: { in: toMove.map((c) => c.id) } },
        data: { seriesId: intoId, sourceId: intoActiveSource?.id ?? null },
      }),
    );
  }
  if (!intoProgress && fromProgress) {
    const lastReadChapterId =
      fromProgress.lastReadChapterId && movedIds.has(fromProgress.lastReadChapterId)
        ? fromProgress.lastReadChapterId
        : null;
    ops.push(
      db.readingProgress.create({
        data: { userId, seriesId: intoId, lastReadChapterId },
      }),
    );
  }
  // The moves (and the progress carry-over) must land before `from` is deleted, since the
  // delete cascades from's remaining (duplicate) chapters/sources/progress.
  ops.push(db.series.delete({ where: { id: fromId } }));
  await db.$transaction(ops);

  return { movedChapters: toMove.length, deleted: true };
}

/** Series detail for the cleanup UI: chapters + sources, scoped to the current user. */
export async function listSeriesForCleanup(seriesId: string) {
  const userId = getCurrentUserId();
  const series = await db.series.findFirst({
    where: { id: seriesId, userId },
    include: {
      chapters: { select: { id: true, number: true, title: true, url: true } },
      sources: { select: { id: true, type: true, url: true, feedUrl: true } },
    },
  });
  return series ?? null;
}
