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
 * on their chapter-TOC URL when known, else their normalized page URL (WP-39b) — so a home-URL add
 * (whose `tocUrl` resolved to the TOC) and a direct TOC-URL add collapse to one id. Scheme/www-insensitive
 * on top of `canonicalUrl` (which already strips the fragment + trailing slash + tracking params and
 * lowercases the host). Pure.
 *
 * A CATEGORY value is `slugify`d so a re-add resolving to the positive match (the raw category *name*,
 * e.g. "Silver Moon Saga") converges with one resolving to the fallback match (the URL *slug*,
 * "silver-moon-saga") — `chooseSeriesMatch` picks the category precisely because `slugify(name)` equals
 * that slug. (Deeper matcher-window flips — WHOLE_FEED↔CATEGORY↔PATH_PREFIX across feed windows — are a
 * known residual for a multi-novel feed; see WP-39b.)
 */
export function canonicalSeriesId(input: { feedUrl: string | null; tocUrl?: string | null; sourceUrl: string; match: SeriesMatch }): string {
  // Feed series key on the feed; page-watch series key on the chapter TOC when known (WP-39b), so a
  // home-URL add (whose tocUrl resolved to the TOC) and a direct TOC-URL add collapse to one id.
  const base = stripSchemeWww(canonicalUrl(input.feedUrl ?? input.tocUrl ?? input.sourceUrl));
  if (input.feedUrl === null) return base; // page-watch: keyed on tocUrl ?? sourceUrl
  const m = input.match;
  const suffix =
    m.type === 'WHOLE_FEED'
      ? m.type
      : m.type === 'CATEGORY'
        ? `CATEGORY:${slugify(m.value)}` // name↔slug convergence
        : `PATH_PREFIX:${m.value}`; // path is identical across positive/fallback matches
  return `${base}#${suffix}`;
}

/** Normalize a title to lowercase alphanumeric tokens, dropping a single leading article. */
function normalizeTitleTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

/** True when `short` is a leading token-prefix of `long` (equal arrays included). */
function isTokenPrefix(short: string[], long: string[]): boolean {
  if (short.length === 0 || short.length > long.length) return false;
  return short.every((t, i) => t === long[i]);
}

/**
 * Find an existing series whose title is a surface-variant of `candidate` (WP-39b): normalized equality
 * or one being a leading token-prefix of the other (an added article or subtitle). Pure. Returns the first
 * match, else null. Deliberately NOT fuzzy — this cannot catch a different *translation* of the same work
 * (different renderings share no tokens); that case is resolved by manual merge (WP-CLEANUP-UI).
 */
export function findSimilarTitle(
  candidate: string,
  existing: { id: string; title: string }[],
): { id: string; title: string } | null {
  const cand = normalizeTitleTokens(candidate);
  if (cand.length === 0) return null;
  for (const e of existing) {
    const et = normalizeTitleTokens(e.title);
    if (et.length === 0) continue;
    const [short, long] = cand.length <= et.length ? [cand, et] : [et, cand];
    if (isTokenPrefix(short, long)) return { id: e.id, title: e.title };
  }
  return null;
}
