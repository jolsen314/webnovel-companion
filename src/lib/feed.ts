/**
 * Pure feed (digest) core — orders cross-series chapter events newest-first and
 * groups them by day, and counts events newer than a "seen" watermark. Next-/
 * Prisma-free: the service edge (`server/services/feed.ts`) loads rows and calls
 * this. `now` is injected for purity; day math is UTC (server renders in UTC —
 * a near-midnight local mismatch is an accepted v1 limit, noted in the spec).
 */

export type FeedEventKind = 'NEW_CHAPTER' | 'NOW_FREE';

export interface FeedEvent {
  kind: FeedEventKind;
  at: Date; // NEW_CHAPTER: publishedAt ?? discoveredAt; NOW_FREE: becameFreeAt
  seriesId: string;
  seriesTitle: string;
  chapterNumber: number | null;
  chapterTitle: string;
  chapterUrl: string; // the row body links here (read now)
  read: boolean; // drives dimming; computed by the service
}

export interface DownSource {
  seriesId: string;
  seriesTitle: string;
  host: string;
  sourceUrl: string;
}

export interface FeedInputs {
  events: FeedEvent[];
  downSources: DownSource[];
}

export interface FeedDayGroup {
  key: string; // UTC YYYY-MM-DD
  label: string; // "Today" | "Yesterday" | "Fri, Aug 28"
  items: FeedEvent[]; // newest-first within the day
}

export interface Feed {
  attention: DownSource[];
  groups: FeedDayGroup[]; // newest day first
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const dayKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

function dayLabel(d: Date, now: Date): string {
  const k = dayKey(d);
  if (k === dayKey(now)) return 'Today';
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return `${WEEKDAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Newest-first, day-grouped feed. On an exact-timestamp tie (e.g. a batch insert stamping many
 *  chapters at one instant) the order stays deterministic: same series grouped together, then the
 *  higher chapter number first (newest-first, as a reader expects), with the url only as a final
 *  stable fallback for null/equal numbers. `limit`, when given, caps to the newest N *after*
 *  sorting, so which events survive the cap is decided by this same tie-break, not by input order. */
export function buildFeed(inputs: FeedInputs, now: Date, limit?: number): Feed {
  const sorted = [...inputs.events].sort((a, b) => {
    if (b.at.getTime() !== a.at.getTime()) return b.at.getTime() - a.at.getTime();
    if (a.seriesTitle !== b.seriesTitle) return a.seriesTitle < b.seriesTitle ? -1 : 1;
    if (a.chapterNumber !== b.chapterNumber) {
      if (a.chapterNumber == null) return 1; // nulls last
      if (b.chapterNumber == null) return -1;
      return b.chapterNumber - a.chapterNumber; // higher (newer) chapter number first
    }
    return a.chapterUrl < b.chapterUrl ? -1 : a.chapterUrl > b.chapterUrl ? 1 : 0;
  });
  const events = limit != null ? sorted.slice(0, limit) : sorted;

  const groups: FeedDayGroup[] = [];
  for (const ev of events) {
    const key = dayKey(ev.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(ev);
    else groups.push({ key, label: dayLabel(ev.at, now), items: [ev] });
  }

  const attention = [...inputs.downSources].sort((a, b) => {
    if (a.seriesTitle !== b.seriesTitle) return a.seriesTitle < b.seriesTitle ? -1 : 1;
    return a.host < b.host ? -1 : a.host > b.host ? 1 : 0;
  });

  return { attention, groups };
}

/** How many events are newer than the seen watermark (null → 0, i.e. no divider on a first visit). */
export function countNewSince(feed: Feed, seenAt: Date | null): number {
  if (!seenAt) return 0;
  const cut = seenAt.getTime();
  return feed.groups.reduce((n, g) => n + g.items.filter((e) => e.at.getTime() > cut).length, 0);
}
