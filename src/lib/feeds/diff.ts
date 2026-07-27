/**
 * New-chapter diffing: given the chapters already stored for a series and the
 * items just fetched from its feed (or a page-watch), return the genuinely new ones.
 *
 * Pure and order-independent. Identity is matched on guid AND canonical url
 * independently (either one matching = already seen), never title or position —
 * so reordered/edited feeds and guid-presence changes don't produce false positives.
 */

export interface FeedItem {
  /** Stable feed id (RSS <guid> / Atom <id>), if the source provides one. */
  guid?: string;
  /** Chapter URL. Also an identity key (canonicalized). */
  url: string;
  title: string;
  number?: number | null;
  publishedAt?: Date | null;
  /** Feed `<category>` values — used to isolate a series in a multi-novel feed (see match logic). */
  categories?: string[];
  /** Free/locked state, populated by page-watch (`parseToc`) for paid/advance sites. */
  access?: 'FREE' | 'LOCKED';
}

/** The minimum needed to recognize an already-seen chapter. */
export interface KnownChapter {
  /** DB row id, when known (from the store). Lets the unlock update target the exact row. */
  id?: string;
  guid?: string;
  url: string;
  /** Stored access state (page-watch sources). Undefined for feed sources that never tracked locks. */
  access?: 'FREE' | 'LOCKED';
}

export interface DiffResult {
  /** Chapters present in the fetch but not yet stored, in fetched order. */
  new: FeedItem[];
  /** Stored chapters whose access was LOCKED and is now FREE (the "now free" event). Carries the
   *  stored identity (id/url) so persistence targets the exact row, matching the diff's own
   *  canonical-url/guid detection. */
  becameFree: KnownChapter[];
  /** Already-seen chapters whose stored access was UNKNOWN and is now known (FREE/LOCKED) from a TOC read.
   *  Silent — access is *learned*, not an unlock. Carries the stored identity for by-id persistence. */
  accessReconciled: KnownChapter[];
  // Extension point: keep this an object so future diff dimensions attach as new
  // fields without breaking callers — e.g. `disappeared` (for source-health / removal).
}

/** Query keys that never identify a chapter — analytics/referral noise. */
const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAMS = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid', 'igshid', 'yclid', 'ref_src']);

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAMS.has(key) || TRACKING_PARAM_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Canonicalize a URL for identity comparison so cosmetic variants of the same
 * chapter link collapse to one key. Drops the fragment and any trailing slash,
 * strips known tracking params (utm_*, fbclid, …), and sorts the remaining
 * (meaningful) query params so ordering doesn't matter. The hostname is
 * lowercased and default ports removed for free by the URL parser; the path is
 * left case-sensitive. Falls back to a trimmed raw string if the URL won't parse.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    const kept = [...u.searchParams.entries()]
      .filter(([key]) => !isTrackingParam(key))
      .sort((a, b) => `${a[0]}=${a[1]}`.localeCompare(`${b[0]}=${b[1]}`));
    u.search = '';
    for (const [key, value] of kept) u.searchParams.append(key, value);
    return u.toString();
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

export function diffChapters(stored: KnownChapter[], fetched: FeedItem[]): DiffResult {
  // Track guids and canonical URLs separately, and treat a chapter as seen if
  // EITHER matches. This keeps identity stable when a feed starts/stops emitting
  // guids, or when a feed source (guid) and a page-watch source (url-only) mix
  // for one series — either recorded key still recognizes the chapter.
  const seenGuids = new Set<string>();
  const seenUrls = new Set<string>();
  // Stored chapters keyed by identity (every stored chapter, regardless of access), so an
  // already-seen fetched item can recover the exact stored row (and its access) to detect a
  // LOCKED→FREE unlock or access reconciliation (including from UNKNOWN access).
  const storedByGuid = new Map<string, KnownChapter>();
  const storedByUrl = new Map<string, KnownChapter>();

  const remember = (c: KnownChapter | FeedItem): void => {
    if (c.guid !== undefined) seenGuids.add(c.guid);
    seenUrls.add(canonicalUrl(c.url));
  };
  const isSeen = (c: FeedItem): boolean =>
    (c.guid !== undefined && seenGuids.has(c.guid)) || seenUrls.has(canonicalUrl(c.url));

  for (const c of stored) {
    remember(c);
    if (c.guid !== undefined) storedByGuid.set(c.guid, c);
    storedByUrl.set(canonicalUrl(c.url), c);
  }

  const storedMatch = (c: FeedItem): KnownChapter | undefined => {
    if (c.guid !== undefined && storedByGuid.has(c.guid)) return storedByGuid.get(c.guid);
    return storedByUrl.get(canonicalUrl(c.url));
  };

  const fresh: FeedItem[] = [];
  const becameFree: KnownChapter[] = [];
  const accessReconciled: KnownChapter[] = [];
  const unlockedUrls = new Set<string>(); // guard against a duplicated fetched row double-counting
  const reconciledUrls = new Set<string>();
  for (const item of fetched) {
    if (isSeen(item)) {
      const key = canonicalUrl(item.url);
      const match = storedMatch(item);
      if (item.access === 'FREE' && match?.access === 'LOCKED' && !unlockedUrls.has(key)) {
        unlockedUrls.add(key);
        becameFree.push(match); // the STORED chapter — carries id/url for exact-row persistence
      } else if (
        (item.access === 'FREE' || item.access === 'LOCKED') &&
        match !== undefined &&
        match.access === undefined &&
        !reconciledUrls.has(key)
      ) {
        reconciledUrls.add(key);
        accessReconciled.push({ ...match, access: item.access }); // stored identity + the newly-learned access
      }
      continue; // already stored, or a duplicate earlier in this batch
    }
    remember(item);
    fresh.push(item);
  }
  return { new: fresh, becameFree, accessReconciled };
}
