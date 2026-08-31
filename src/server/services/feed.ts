import { db } from '../db';
import { getCurrentUserId } from '../user';
import { orderChaptersForReading } from '../../lib/reading';
import { buildFeed, type DownSource, type Feed, type FeedEvent } from '../../lib/feed';

/** Derived digest (WP-28c): READING-series chapter events in a bounded window, plus a
 *  consolidated list of currently-down sources. No schema change — read-only over Chapter
 *  timestamps + Source health. Decision logic (order/group) lives in the pure `buildFeed`. */
const WINDOW_DAYS = 30;
const MAX_EVENTS = 150;

export async function getFeed(now: Date = new Date()): Promise<Feed> {
  const userId = getCurrentUserId();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const series = await db.series.findMany({
    where: { userId, status: 'READING' },
    include: {
      progress: true,
      chapters: {
        select: {
          id: true,
          title: true,
          url: true,
          number: true,
          position: true,
          publishedAt: true,
          discoveredAt: true,
          access: true,
          becameFreeAt: true,
        },
      },
      // Currently-down sources only → the consolidated "needs attention" strip.
      sources: { where: { isActive: true, linkOnly: false, health: 'LIKELY_DOWN' }, select: { host: true, url: true } },
    },
  });

  const events: FeedEvent[] = [];
  const downSources: DownSource[] = [];

  for (const s of series) {
    const ordered = orderChaptersForReading(s.chapters);
    const lastReadIdx = s.progress?.lastReadChapterId
      ? ordered.findIndex((c) => c.id === s.progress!.lastReadChapterId)
      : -1;
    // Everything up to and including the pointer is read (empty set when there's no progress).
    const readIds = new Set(ordered.slice(0, lastReadIdx + 1).map((c) => c.id));

    for (const c of s.chapters) {
      const newAt = c.publishedAt ?? c.discoveredAt;
      // NEW_CHAPTER = readable from the start, never locked. A chapter that ever
      // became free (becameFreeAt != null) belongs to the NOW_FREE stream only —
      // this guard is what keeps one chapter from notifying twice.
      if (c.access !== 'LOCKED' && c.becameFreeAt == null && newAt >= since) {
        events.push({
          kind: 'NEW_CHAPTER',
          at: newAt,
          seriesId: s.id,
          seriesTitle: s.title,
          chapterNumber: c.number,
          chapterTitle: c.title,
          chapterUrl: c.url,
          read: readIds.has(c.id),
        });
      }
      if (c.becameFreeAt && c.becameFreeAt >= since) {
        events.push({
          kind: 'NOW_FREE',
          at: c.becameFreeAt,
          seriesId: s.id,
          seriesTitle: s.title,
          chapterNumber: c.number,
          chapterTitle: c.title,
          chapterUrl: c.url,
          read: readIds.has(c.id),
        });
      }
    }

    for (const src of s.sources) {
      downSources.push({ seriesId: s.id, seriesTitle: s.title, host: src.host, sourceUrl: src.url });
    }
  }

  // Cap to the newest MAX_EVENTS before grouping; buildFeed sorts authoritatively.
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return buildFeed({ events: events.slice(0, MAX_EVENTS), downSources }, now);
}
