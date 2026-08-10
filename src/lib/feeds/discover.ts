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

/** Slug-normalize a string: lowercase, drop apostrophes/punctuation, spaces → hyphens.
 *  Exported so `canonicalSeriesId` (WP-39) can converge a positive CATEGORY match (the raw
 *  category name) with the fallback match (the URL slug) — both slugify to the same key. */
export function slugify(s: string): string {
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

  // No positive tie. If the feed is *demonstrably* multi-novel — ≥2 distinct novel
  // categories, or other works sitting under the series' parent path — the series is just
  // absent from this window, so isolate defensively (via the fallback) rather than let a
  // *discovered* site-wide feed default to WHOLE_FEED and ingest every other work (+ take
  // its title from a stray channel entry). Otherwise (a single work, or we genuinely can't
  // tell) return null, so a real per-series feed with a custom URL scheme stays WHOLE_FEED.
  const parentSegments = seriesPath.split('/').filter(Boolean).slice(0, -1);
  const parentPrefix = parentSegments.length > 0 ? `/${parentSegments.join('/')}/` : null;
  let otherWorkPaths = false;
  if (parentPrefix) {
    for (const it of items) {
      try {
        const path = new URL(it.url).pathname;
        if (path.startsWith(parentPrefix)) {
          const work = path.slice(parentPrefix.length).split('/').filter(Boolean)[0];
          if (work && work !== slug) {
            otherWorkPaths = true;
            break;
          }
        }
      } catch {
        // ignore unparseable urls
      }
    }
  }
  const multiNovel = novelCategories.size >= 2 || otherWorkPaths;
  return multiNovel ? fallbackSeriesMatch(items, seriesUrl) : null;
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

/** Anchor texts that denote a link to the chapter table of contents (WP-37). Anchored so a
 *  bare "Chapter N" / "Chapter 3: Index …" link is never mistaken for the TOC itself.
 *  The bare `toc`/`index` tokens were dropped (post-review hardening, 2026-07-31): a site
 *  footer/nav link literally texted "Index" or "TOC" was resolving a spurious TOC URL for
 *  feed series — too false-positive-prone for bare nav/chrome links. */
const TOC_LINK_TEXT = /^(?:table of contents|chapter list|all chapters)$/i;

/** Strip tags, decode nothing (labels are plain text), collapse whitespace, trim. */
function linkText(anchor: string): string {
  return anchor
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the landing page's link to its chapter table of contents, when the TOC lives on a
 * separate page (WP-37). Pure. Returns the first same-host, absolute URL whose anchor text
 * matches `TOC_LINK_TEXT` and that isn't the current page; else null (the landing page IS the
 * TOC, or no link is discoverable → caller falls back to `url`).
 */
export function findTocUrl(html: string, baseUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  const current = `${base.origin}${base.pathname}`;
  for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []) {
    const openTag = anchor.match(/<a\b[^>]*>/i)?.[0] ?? '';
    const href = attr(openTag, 'href');
    if (!href) continue;
    if (!TOC_LINK_TEXT.test(linkText(anchor))) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.host !== base.host) continue; // same-host only
    if (`${resolved.origin}${resolved.pathname}` === current) continue; // not a self-link
    return resolved.toString();
  }
  return null;
}

/** Common feed-URL fallbacks to try when a page advertises none (mostly WordPress). */
export function guessFeedUrls(pageUrl: string): string[] {
  try {
    const u = new URL(pageUrl);
    const page = `${u.origin}${u.pathname.replace(/\/?$/, '/')}`; // ensure trailing slash
    const wp = [`${page}feed/`, `${u.origin}/feed/`]; // WordPress-style
    // Blogger's blog-level feed (Atom + the RSS variant; rss-parser reads both).
    const blogger = [`${u.origin}/feeds/posts/default`, `${u.origin}/feeds/posts/default?alt=rss`];
    // *.blogspot.com → Blogger first (skip the WP 404s). Any other host → Blogger LAST, a universal
    // last-resort that also rescues custom-domain / ccTLD Blogger. `looksLikeFeed` (in addSeries) plus
    // strict-last ordering keep the rare non-Blogger wrong-bind risk small.
    const isBlogspot = u.hostname === 'blogspot.com' || u.hostname.endsWith('.blogspot.com');
    return isBlogspot ? [...blogger, ...wp] : [...wp, ...blogger];
  } catch {
    return [];
  }
}
