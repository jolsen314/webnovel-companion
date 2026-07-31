import { canonicalUrl } from './feeds/diff';
import { slugify, type SeriesMatch } from './feeds/discover';

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
 *
 * A CATEGORY value is `slugify`d so a re-add resolving to the positive match (the raw category *name*,
 * e.g. "Silver Moon Saga") converges with one resolving to the fallback match (the URL *slug*,
 * "silver-moon-saga") — `chooseSeriesMatch` picks the category precisely because `slugify(name)` equals
 * that slug. (Deeper matcher-window flips — WHOLE_FEED↔CATEGORY↔PATH_PREFIX across feed windows — are a
 * known residual for a multi-novel feed; see WP-39b.)
 */
export function canonicalSeriesId(input: { feedUrl: string | null; sourceUrl: string; match: SeriesMatch }): string {
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.sourceUrl));
  if (input.feedUrl === null) return base; // page-watch: the URL is the identity (match is always WHOLE_FEED)
  const m = input.match;
  const suffix =
    m.type === 'WHOLE_FEED'
      ? m.type
      : m.type === 'CATEGORY'
        ? `CATEGORY:${slugify(m.value)}` // name↔slug convergence
        : `PATH_PREFIX:${m.value}`; // path is identical across positive/fallback matches
  return `${base}#${suffix}`;
}
