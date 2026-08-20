/**
 * Extract a series' human title from its landing/reading page HTML (WP-30). Pure.
 * Precedence: <h1> (usually clean, no site suffix) → og:title → <title>. For the meta/title
 * fallbacks, a trailing "<sep> SiteName" suffix is stripped conservatively — only when the tail
 * matches the known site name (so a legitimate dash in a title survives), except a bare pipe,
 * which is almost always a site separator, is stripped even without a known site name.
 *
 * Each candidate is also rejected outright if it loosely matches the site name (see
 * `matchesSiteName`) — e.g. a site that puts its brand in the first <h1> — or if it looks like a
 * consent/cookie banner (WP-30b: some sites' sole <h1> is a CCPA/cookie notice), falling through
 * to the next signal in precedence. If every signal is empty/site-name/consent, returns null.
 *
 * HTML entities in every candidate are decoded (WP-30b) so `&#8217;`/`&#038;`/`&nbsp;` land as
 * glyphs, not raw codes; new adds are clean and WP-30's backfill self-heals existing rows.
 */

import { decodeHTML } from 'entities';

/** Loose site-name match: case-insensitive, ignoring a leading www., a trailing TLD, and any
 *  non-alphanumerics — so a spaced display name ("Verdant Scrolls") matches a concatenated host
 *  ("verdantscrolls.example"). TLD strip runs BEFORE the alnum strip (it needs the dot). */
export function matchesSiteName(text: string, siteName: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/^www\./, '')
      .replace(/\.[a-z]{2,}$/, '') // drop a trailing TLD (dot still present here)
      .replace(/[^a-z0-9]/g, ''); // then drop spaces/punctuation
  const a = norm(text);
  const b = norm(siteName);
  return a.length > 0 && a === b;
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  // Decode HTML entities (named + numeric) before collapsing whitespace, so a decoded &nbsp;
  // (U+00A0, which \s matches) folds into a normal space rather than baking in raw.
  const t = decodeHTML(s).replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
}

/**
 * Boilerplate seen as the sole <h1> on some sites: a CCPA/cookie consent banner instead of the
 * series name (WP-30b). Loose substring match on known consent/cookie phrases — conservative
 * enough not to reject a real title, since these strings don't occur in webnovel names.
 */
const CONSENT_PHRASES = [
  'we value your privacy',
  'your privacy choices',
  'opt out of the sale or sharing of personal information',
  'do not sell or share my personal information',
  'uses cookies',
  'we use cookies',
  'cookie preferences',
  'cookie policy',
  'cookie consent',
  'accept all cookies',
  'manage consent',
];
function looksLikeConsentBanner(text: string): boolean {
  const t = text.toLowerCase();
  return CONSENT_PHRASES.some((p) => t.includes(p));
}

function attrContent(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? clean(m[1]) : null;
}

/** Strip a trailing "<sep> X" suffix: only when X matches siteName, OR (for a pipe) always. */
function stripSiteSuffix(title: string, siteName?: string): string {
  const m = /^(.*?)(\s*[|\-–—]\s*)([^|\-–—]+)$/.exec(title);
  if (!m) return title;
  const [, head, sep, tail] = m;
  const isPipe = sep!.includes('|');
  if (isPipe || (siteName != null && matchesSiteName(tail!.trim(), siteName))) {
    const stripped = clean(head);
    if (stripped) return stripped;
  }
  return title;
}

export function extractSeriesTitle(html: string, opts?: { siteName?: string }): string | null {
  const siteName = opts?.siteName;
  const qualifies = (candidate: string | null): candidate is string =>
    candidate != null &&
    candidate.length > 0 &&
    !looksLikeConsentBanner(candidate) &&
    (siteName == null || !matchesSiteName(candidate, siteName));

  const h1Raw = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? null;
  const h1Text = h1Raw != null ? clean(h1Raw.replace(/<[^>]*>/g, '')) : null;
  if (qualifies(h1Text)) return h1Text; // <h1> is trusted as-is (no site suffix in practice)

  const og = attrContent(html, /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    ?? attrContent(html, /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  const ogText = og ? stripSiteSuffix(og, siteName) : null;
  if (qualifies(ogText)) return ogText;

  const title = attrContent(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = title ? stripSiteSuffix(title, siteName) : null;
  if (qualifies(titleText)) return titleText;

  return null;
}
