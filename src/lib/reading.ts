/**
 * Unread count for a series: how many chapters come after the last-read one, given
 * chapter ids in reading order. No progress → everything is unread. A stale
 * last-read id (e.g. after re-pointing to a new source, before the manual reconcile)
 * isn't in the list, so we fall back to all-unread. Pure.
 */
export function unreadCount(orderedChapterIds: string[], lastReadChapterId: string | null | undefined): number {
  if (!lastReadChapterId) return orderedChapterIds.length;
  const index = orderedChapterIds.indexOf(lastReadChapterId);
  if (index === -1) return orderedChapterIds.length;
  return orderedChapterIds.length - index - 1;
}

export type ChapterDisplayMode = 'oldest' | 'newest' | 'unread';

/** Compute read-state by canonical position (the pointer's index), then reorder for display. Pure. */
export function arrangeChapters<T extends { id: string }>(
  canonical: readonly T[],
  lastReadId: string | null,
  mode: ChapterDisplayMode,
): (T & { read: boolean })[] {
  const lastIdx = lastReadId ? canonical.findIndex((c) => c.id === lastReadId) : -1;
  const flagged = canonical.map((c, i) => ({ ...c, read: lastIdx >= 0 && i <= lastIdx }));
  if (mode === 'newest') return [...flagged].reverse();
  if (mode === 'unread') return [...flagged.filter((c) => !c.read), ...flagged.filter((c) => c.read)];
  return flagged;
}

/** Title markers for side-stories / extra content, which sort to the END (word-boundary to avoid
 *  false positives like "extraordinary" / "beside"). */
const EXTRA_SIDE = /\bextras?\b|\bside\b/i;

interface OrderableChapter {
  id: string;
  number: number | null;
  title: string;
  position?: number | null;
  publishedAt: Date | null;
  discoveredAt: Date;
}

/** 0 = front (un-numbered prologues), 1 = main (numbered), 2 = end (extra/side content). */
function readingBucket(c: OrderableChapter): 0 | 1 | 2 {
  if (EXTRA_SIDE.test(c.title)) return 2;
  if (c.number == null) return 0;
  return 1;
}

/** Ascending codepoint comparison — a stable final tie-break. Deliberately not `localeCompare`
 *  (locale-dependent), so ordering stays deterministic across environments. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Ascending compare where null sorts last; 0 when equal or both null (→ caller falls through). */
function nullsLastAsc(a: number | null, b: number | null): number {
  if (a != null && b != null) return a - b;
  if (a == null && b != null) return 1;
  if (a != null && b == null) return -1;
  return 0;
}

/** Order chapters for reading: un-numbered prologues first, then the numbered main sequence,
 *  then Extra/Side content — per the owner's rule. Pure; returns a new array. */
export function orderChaptersForReading<T extends OrderableChapter>(chapters: readonly T[]): T[] {
  return [...chapters].sort((a, b) => {
    // Position (the site's own TOC order) wins when known; nulls sort last and fall to the comparator.
    const posCmp = nullsLastAsc(a.position ?? null, b.position ?? null);
    if (posCmp !== 0) return posCmp;
    const ba = readingBucket(a);
    const bb = readingBucket(b);
    if (ba !== bb) return ba - bb;
    // Within the main and end buckets, order by number ascending (nulls last).
    if (ba !== 0) {
      const numCmp = nullsLastAsc(a.number, b.number);
      if (numCmp !== 0) return numCmp;
    }
    // Front bucket, or equal/absent numbers: publishedAt asc (nulls last), then discoveredAt, then id.
    const pubCmp = nullsLastAsc(a.publishedAt?.getTime() ?? null, b.publishedAt?.getTime() ?? null);
    if (pubCmp !== 0) return pubCmp;
    const da = a.discoveredAt.getTime();
    const dbb = b.discoveredAt.getTime();
    if (da !== dbb) return da - dbb;
    return compareStrings(a.id, b.id);
  });
}
