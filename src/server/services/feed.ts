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
          announcedAt: true,
        },
      },
    },
  });

  const events: FeedEvent[] = [];

  for (const s of series) {
    const ordered = orderChaptersForReading(s.chapters);
    const lastReadIdx = s.progress?.lastReadChapterId
      ? ordered.findIndex((c) => c.id === s.progress!.lastReadChapterId)
      : -1;
    // Everything up to and including the pointer is read (empty set when there's no progress).
    const readIds = new Set(ordered.slice(0, lastReadIdx + 1).map((c) => c.id));

    for (const c of s.chapters) {
      // NEW_CHAPTER = a genuine new arrival a poll discovered (announcedAt set) — readable, never
      // locked, and not a formerly-locked chapter (that belongs to the NOW_FREE stream). Keying off
      // announcedAt, not discoveredAt, is what keeps add/backfill imports out of the feed (mirrors
      // push, which fires from poll effects, never from bulk imports).
      if (c.announcedAt != null && c.access !== 'LOCKED' && c.becameFreeAt == null && c.announcedAt >= since) {
        events.push({
          kind: 'NEW_CHAPTER',
          at: c.announcedAt,
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
  }

  // The "needs attention" strip is NOT scoped to READING (events are): a currently-down source is
  // actionable on any series you still expect new chapters from — i.e. not COMPLETED (a finished work
  // needs no more chapters) and not DROPPED (given up on purpose). Queried separately from the events.
  const downRows = await db.source.findMany({
    where: {
      isActive: true,
      linkOnly: false,
      health: 'LIKELY_DOWN',
      series: { userId, status: { notIn: ['DROPPED', 'COMPLETED'] } },
    },
    select: { host: true, url: true, series: { select: { id: true, title: true } } },
  });
  const downSources: DownSource[] = downRows.map((r) => ({
    seriesId: r.series.id,
    seriesTitle: r.series.title,
    host: r.host,
    sourceUrl: r.url,
  }));

  // buildFeed sorts (with its deterministic tie-break) and caps to the newest MAX_EVENTS.
  return buildFeed({ events, downSources }, now, MAX_EVENTS);
}
