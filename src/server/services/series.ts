import { Prisma } from '@prisma/client';
import { db } from '../db';
import { getCurrentUserId } from '../user';
import { unreadCount } from '../../lib/reading';
import type { SeriesUpdate } from '../api/validation';

/**
 * Series read/write services (Prisma-backed, scoped to the current user). Thin glue;
 * integration-tested at WP-11. The unread math uses the pure `unreadCount` helper.
 */

const chapterOrder: Prisma.ChapterOrderByWithRelationInput[] = [
  { publishedAt: { sort: 'asc', nulls: 'last' } },
  { discoveredAt: 'asc' },
];

/** The library list: each series with its latest chapter, unread count, and active-source health. */
export async function listSeries() {
  const userId = getCurrentUserId();
  const rows = await db.series.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      progress: true,
      chapters: { orderBy: chapterOrder, select: { id: true, title: true, url: true, number: true, publishedAt: true, discoveredAt: true } },
      sources: { where: { isActive: true }, take: 1, select: { url: true, host: true, health: true } },
    },
  });

  return rows.map((s) => {
    const latest = s.chapters.at(-1) ?? null;
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      rating: s.rating,
      coverUrl: s.coverUrl,
      language: s.language,
      chapterCount: s.chapters.length,
      unread: unreadCount(
        s.chapters.map((c) => c.id),
        s.progress?.lastReadChapterId ?? null,
      ),
      latestChapter: latest
        ? { id: latest.id, title: latest.title, url: latest.url, number: latest.number, at: latest.publishedAt ?? latest.discoveredAt }
        : null,
      activeSource: s.sources[0] ?? null,
    };
  });
}

/** Full detail for one series (chapters in reading order, sources, progress). */
export async function getSeries(id: string) {
  const userId = getCurrentUserId();
  return db.series.findFirst({
    where: { id, userId },
    include: {
      progress: true,
      sources: true,
      chapters: { orderBy: chapterOrder },
    },
  });
}

/** Update shelf fields and/or reading progress. Returns null if the series isn't the user's. */
export async function updateSeries(id: string, patch: SeriesUpdate): Promise<{ id: string } | null> {
  const userId = getCurrentUserId();
  const owned = await db.series.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) return null;

  const ops: Prisma.PrismaPromise<unknown>[] = [];

  const seriesData: Prisma.SeriesUpdateInput = {};
  if (patch.status !== undefined) {
    seriesData.status = patch.status;
    if (patch.status === 'COMPLETED') seriesData.finishedAt = new Date();
  }
  if (patch.rating !== undefined) seriesData.rating = patch.rating;
  if (patch.notes !== undefined) seriesData.notes = patch.notes;
  if (Object.keys(seriesData).length > 0) ops.push(db.series.update({ where: { id }, data: seriesData }));

  if (patch.lastReadChapterId !== undefined) {
    ops.push(
      db.readingProgress.upsert({
        where: { seriesId: id },
        create: { seriesId: id, userId, lastReadChapterId: patch.lastReadChapterId },
        update: { lastReadChapterId: patch.lastReadChapterId },
      }),
    );
  }

  if (ops.length > 0) await db.$transaction(ops);
  return { id };
}
