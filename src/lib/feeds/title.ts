/**
 * Extract a series' human title from its landing/reading page HTML (WP-30). Pure.
 * Precedence: <h1> (usually clean, no site suffix) → og:title → <title>. For the meta/title
 * fallbacks, a trailing "<sep> SiteName" suffix is stripped conservatively — only when the tail
 * matches the known site name (so a legitimate dash in a title survives), except a bare pipe,
 * which is almost always a site separator, is stripped even without a known site name.
 *
 * Each candidate is also rejected outright if it loosely matches the site name (see
 * `matchesSiteName`) — e.g. a site that puts its brand in the first <h1> — falling through to
 * the next signal in precedence. If every signal is empty or is just the site name, returns null.
 */

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
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
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
    candidate != null && candidate.length > 0 && (siteName == null || !matchesSiteName(candidate, siteName));

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
