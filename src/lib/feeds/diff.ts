/**
 * New-chapter diffing: given the chapters already stored for a series and the
 * items just fetched from its feed (or a page-watch), return the genuinely new ones.
 *
 * Pure and order-independent. Identity is a stable key (guid, else canonical url),
 * never title or position — so reordered and edited feeds don't produce false positives.
 */

export interface FeedItem {
  /** Stable feed id, if the feed provides one. Preferred identity. */
  guid?: string;
  /** Chapter URL. Identity fallback when no guid. */
  url: string;
  title: string;
  number?: number | null;
  publishedAt?: Date | null;
}

/** The minimum needed to recognize an already-seen chapter. */
export interface KnownChapter {
  guid?: string;
  url: string;
}

export interface DiffResult {
  new: FeedItem[];
}

/**
 * Canonicalize a URL for identity comparison: drop the fragment and any
 * trailing slash so cosmetic variants of the same chapter link collapse to one
 * key. Falls back to a trimmed raw string if the URL doesn't parse.
 */
function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

/** Stable identity for a chapter: its guid if present, else its canonical URL. */
function identity(chapter: KnownChapter | FeedItem): string {
  return chapter.guid ?? canonicalUrl(chapter.url);
}

export function diffChapters(stored: KnownChapter[], fetched: FeedItem[]): DiffResult {
  const seen = new Set(stored.map(identity));
  const fresh: FeedItem[] = [];
  for (const item of fetched) {
    const key = identity(item);
    if (seen.has(key)) continue; // already stored, or a duplicate earlier in this batch
    seen.add(key);
    fresh.push(item);
  }
  return { new: fresh };
}
