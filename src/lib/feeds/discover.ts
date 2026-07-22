/**
 * Feed auto-discovery from a page's HTML. Pure (HTML string → candidate feed URLs);
 * the actual page fetch lives in the fetcher.
 *
 * The spike showed discovery works when the page loads, but the advertised feed is
 * often a site-wide/multi-novel one (so pair this with the series matcher), and some
 * pages are Cloudflare-blocked (so `guessFeedUrls` provides fallbacks to try directly).
 */

export interface DiscoveredFeed {
  url: string;
  type: 'rss' | 'atom';
  title: string | null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}=["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1]! : null;
}

/** Extract `<link rel="alternate" type="application/(rss|atom)+xml">` feeds, resolving relative hrefs. */
export function discoverFeeds(html: string, baseUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel') ?? '';
    const type = attr(tag, 'type') ?? '';
    const href = attr(tag, 'href');
    if (!href || !/\balternate\b/i.test(rel)) continue;
    const kind = /rss\+xml/i.test(type) ? 'rss' : /atom\+xml/i.test(type) ? 'atom' : null;
    if (!kind) continue;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    feeds.push({ url, type: kind, title: attr(tag, 'title') });
  }
  return feeds;
}

import type { FeedItem } from './diff';

/**
 * How to isolate one series' items within a (possibly site-wide, multi-novel) feed.
 * Maps to the `Source.matchType`/`matchValue` columns at persistence.
 */
export type SeriesMatch =
  | { type: 'WHOLE_FEED' }
  | { type: 'CATEGORY'; value: string }
  | { type: 'PATH_PREFIX'; value: string };

/** Generic WordPress categories that never identify a specific novel. */
const GENERIC_CATEGORIES = new Set(['normal', 'uncategorized', 'uncategorised', 'novel', 'chapter', 'chapters']);

/** Slug-normalize a string: lowercase, drop apostrophes/punctuation, spaces → hyphens. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Decide how to isolate a series in its feed (see ADR 0001 + the 2026-07-16 spike):
 * single-novel feed → WHOLE_FEED; multi-novel → the per-novel CATEGORY that matches
 * the series slug if one exists, else fall back to the series URL PATH_PREFIX (the
 * series may just be absent from the current capped feed window).
 */
export function chooseSeriesMatch(items: FeedItem[], seriesUrl: string): SeriesMatch | null {
  let seriesPath: string;
  try {
    seriesPath = new URL(seriesUrl).pathname.replace(/\/?$/, '/'); // ensure trailing slash
  } catch {
    return null;
  }
  const slug = seriesPath.split('/').filter(Boolean).pop() ?? '';

  // 1. Positive category tie: a per-novel category whose slug matches the series slug.
  const novelCategories = new Set<string>();
  for (const it of items) {
    for (const c of it.categories ?? []) {
      if (!GENERIC_CATEGORIES.has(c.toLowerCase())) novelCategories.add(c);
    }
  }
  const matchedCategory = [...novelCategories].find((c) => slugify(c) === slug);
  if (matchedCategory) return { type: 'CATEGORY', value: matchedCategory };

  // 2. Path ties: every item under the series path ⇒ this feed IS the series'; some ⇒ isolate by path.
  const underSeriesPath = (url: string): boolean => {
    try {
      return new URL(url).pathname.startsWith(seriesPath);
    } catch {
      return false;
    }
  };
  const pathItems = items.filter((it) => underSeriesPath(it.url));
  if (items.length > 0 && pathItems.length === items.length) return { type: 'WHOLE_FEED' };
  if (pathItems.length > 0) return { type: 'PATH_PREFIX', value: seriesPath };

  // Can't positively identify this series in the feed (e.g. a site-wide feed whose
  // current window doesn't include this novel). Caller falls back (see below).
  return null;
}

/**
 * A best-effort series-scoped match for when `chooseSeriesMatch` can't positively
 * isolate the series (the novel isn't in the feed's current window). Keyed by
 * category-slug if the feed is categorized (WordPress), else by the series URL path.
 * It captures nothing now but fills in when the series next publishes — and if it
 * never does, WP-RC escalates the source to page-watch.
 */
export function fallbackSeriesMatch(items: FeedItem[], seriesUrl: string): SeriesMatch {
  let seriesPath: string;
  try {
    seriesPath = new URL(seriesUrl).pathname.replace(/\/?$/, '/');
  } catch {
    return { type: 'WHOLE_FEED' };
  }
  const slug = seriesPath.split('/').filter(Boolean).pop() ?? '';
  const categorized = items.some((it) => (it.categories ?? []).length > 0);
  return categorized ? { type: 'CATEGORY', value: slug } : { type: 'PATH_PREFIX', value: seriesPath };
}

/**
 * Apply a stored SeriesMatch to a fetched feed's items, keeping only the ones that
 * belong to this series. Runtime counterpart to `chooseSeriesMatch` (which decides
 * the match at add-time).
 */
export function filterBySeriesMatch(items: FeedItem[], match: SeriesMatch): FeedItem[] {
  switch (match.type) {
    case 'WHOLE_FEED':
      return items;
    case 'CATEGORY':
      // Match the exact category, or (for a slug-keyed fallback) any category whose slug matches.
      return items.filter((it) => (it.categories ?? []).some((c) => c === match.value || slugify(c) === match.value));
    case 'PATH_PREFIX':
      return items.filter((it) => {
        try {
          return new URL(it.url).pathname.startsWith(match.value);
        } catch {
          return false;
        }
      });
  }
}

/** Common feed-URL fallbacks to try when a page advertises none (mostly WordPress). */
export function guessFeedUrls(pageUrl: string): string[] {
  try {
    const u = new URL(pageUrl);
    const page = `${u.origin}${u.pathname.replace(/\/?$/, '/')}`; // ensure trailing slash
    return [`${page}feed/`, `${u.origin}/feed/`];
  } catch {
    return [];
  }
}
