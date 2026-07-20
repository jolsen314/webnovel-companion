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
export function chooseSeriesMatch(items: FeedItem[], seriesUrl: string): SeriesMatch {
  const seriesPath = new URL(seriesUrl).pathname.replace(/\/?$/, '/'); // ensure trailing slash
  const slug = seriesPath.split('/').filter(Boolean).pop() ?? '';

  const novelCategories = new Set<string>();
  for (const it of items) {
    for (const c of it.categories ?? []) {
      if (!GENERIC_CATEGORIES.has(c.toLowerCase())) novelCategories.add(c);
    }
  }

  // Single-novel feed: no competing novels to filter out.
  if (novelCategories.size <= 1) return { type: 'WHOLE_FEED' };

  // Multi-novel: prefer the category whose slug matches the series slug.
  const matched = [...novelCategories].find((c) => slugify(c) === slug);
  if (matched) return { type: 'CATEGORY', value: matched };

  // Otherwise isolate by the series' own URL path.
  return { type: 'PATH_PREFIX', value: seriesPath };
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
