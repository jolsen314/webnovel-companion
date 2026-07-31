import { canonicalUrl } from './feeds/diff';
import type { SeriesMatch } from './feeds/discover';

/** Drop the scheme and a leading `www.` so http/https and www/non-www forms unify. */
function stripSchemeWww(u: string): string {
  return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}

/**
 * A stable per-series identity for add-time dedup (WP-39). Feed series are keyed on their FEED — so a
 * home URL and a TOC URL that resolve to the same feed collapse to one id — plus the series matcher,
 * so two novels sharing one multi-novel site feed stay distinct. Page-watch series (no feed) are keyed
 * on their normalized page URL. Scheme/www-insensitive on top of `canonicalUrl` (which already strips
 * the fragment + trailing slash + tracking params and lowercases the host). Pure.
 */
export function canonicalSeriesId(input: { feedUrl: string | null; sourceUrl: string; match: SeriesMatch }): string {
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.sourceUrl));
  if (input.feedUrl === null) return base; // page-watch: the URL is the identity (match is always WHOLE_FEED)
  const m = input.match;
  const suffix = m.type === 'WHOLE_FEED' ? m.type : `${m.type}:${m.value}`;
  return `${base}#${suffix}`;
}
