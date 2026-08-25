/**
 * Pure sort + filter for the library shelf (WP-28a). Next-/Prisma-free: operates on a
 * minimal `ShelfSeries` shape derived from `listSeries`, so the shelf UI can order and
 * narrow the grid without any of this logic leaking into a server component. All functions
 * return a new array and never mutate their input.
 */
import type { SeriesStatus } from './series';

export interface ShelfSeries {
  title: string;
  unread: number;
  rating: number | null;
  status: SeriesStatus;
  /** Latest chapter's activity time, or null for a series with no chapters yet. */
  latestChapter: { at: Date } | null;
}

export type ShelfSort = 'recent' | 'unread' | 'title' | 'rating';

export interface ShelfFilter {
  status: SeriesStatus | 'ALL';
  query: string;
  /** Minimum rating to keep (inclusive); null = no rating filter. Unrated rows are excluded when set. */
  minRating: number | null;
}

/** Case-insensitive codepoint comparison — deterministic across environments (deliberately not
 *  `localeCompare`), matching the tie-break convention in `reading.ts`. */
function compareTitle(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  return 0;
}

/** Activity time as a sortable number; a series with no chapters sorts as -Infinity (last, desc). */
function activityMs(row: ShelfSeries): number {
  return row.latestChapter ? row.latestChapter.at.getTime() : -Infinity;
}

/** Descending activity compare. Not subtraction — that yields NaN for two no-chapter rows
 *  (-Infinity − -Infinity), which would poison the comparator and skip the title tie-break. */
function compareActivityDesc(a: ShelfSeries, b: ShelfSeries): number {
  const ma = activityMs(a);
  const mb = activityMs(b);
  if (ma === mb) return 0;
  return mb > ma ? 1 : -1;
}

/** Order the shelf by the chosen mode. Pure; returns a new array. Title is the final tie-break. */
export function sortSeries<T extends ShelfSeries>(rows: readonly T[], mode: ShelfSort): T[] {
  return [...rows].sort((a, b) => {
    switch (mode) {
      case 'recent': {
        const cmp = compareActivityDesc(a, b);
        if (cmp !== 0) return cmp;
        break;
      }
      case 'unread': {
        if (b.unread !== a.unread) return b.unread - a.unread;
        const cmp = compareActivityDesc(a, b);
        if (cmp !== 0) return cmp;
        break;
      }
      case 'rating': {
        // Highest first; unrated (null) sorts last regardless of direction.
        const ra = a.rating ?? -Infinity;
        const rb = b.rating ?? -Infinity;
        if (rb !== ra) return rb - ra;
        break;
      }
      case 'title':
        break;
    }
    return compareTitle(a.title, b.title);
  });
}

/** Narrow the shelf by status, a title substring, and a minimum rating. Pure; returns a new array. */
export function filterSeries<T extends ShelfSeries>(rows: readonly T[], filter: ShelfFilter): T[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status !== 'ALL' && row.status !== filter.status) return false;
    if (query && !row.title.toLowerCase().includes(query)) return false;
    if (filter.minRating != null && (row.rating == null || row.rating < filter.minRating)) return false;
    return true;
  });
}
