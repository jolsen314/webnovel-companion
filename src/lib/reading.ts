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
