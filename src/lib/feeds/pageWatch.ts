import * as cheerio from 'cheerio';
import { parseChapterNumber } from './parse';
import { canonicalUrl, type FeedItem } from './diff';

/**
 * Page-watch: parse a series' TOC page into chapters, for feedless / dense / paid
 * sites where the feed is missing or misleading (the "now free" event lives only in
 * the TOC's lock markers). Pure (HTML string → chapters); the fetch lives in the
 * fetcher. A generic scan handles most server-rendered sites (WordPress/Madara,
 * Blogger, custom); a per-host `SiteTocConfig` overrides it for the oddballs.
 *
 * JS-rendered and Cloudflare-challenged TOCs need the WP-17b headless/API escalation.
 */

export type ChapterAccess = 'FREE' | 'LOCKED';

export interface TocChapter {
  url: string;
  title: string;
  number: number | null;
  access: ChapterAccess;
}

export interface SiteTocConfig {
  /** CSS selector for the chapter link anchors. */
  chapterSelector: string;
  /** Restrict the scan to this container (drops everything outside it). */
  contentSelector?: string;
  /** Keep only chapters whose URL path contains one of these slug prefixes (supports multiple families). */
  slugFamilies?: string[];
  /** If this selector matches within a chapter's row, the chapter is LOCKED. */
  lockSelector?: string;
  /** Text signals (case-insensitive) that mark a chapter LOCKED. */
  lockText?: string[];
}

const CHAPTER_TEXT = /chapter|\bch\.?\s*\d|\bep(?:isode)?\.?\s*\d|第\s*\d+\s*[章话]/i;
const CHAPTER_HREF = /chapter|\/ch(?:apter)?[-_/]?\d|\/ep(?:isode)?[-_/]?\d|\/v\d+\/\d+/i;
const LOCK_CLASS = /class=["'][^"']*(?:lock|premium|vip|coin)[^"']*["']|fa-lock/i;
const LOCK_TEXT = /locked|premium|\bvip\b|\bcoins?\b|🔒|🔐|unlock/i;
/** Page chrome that must not contribute chapters — sidebars / "recent entries" widgets / nav / footer. */
const CHROME_SELECTOR =
  'aside, nav, header, footer, .sidebar, #sidebar, #secondary, .widget-area, .widget_recent_entries, .recent-posts';

export function parseToc(html: string, baseUrl: string, config?: SiteTocConfig): TocChapter[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const root = config?.contentSelector ? $(config.contentSelector) : $.root();
  const raw = config
    ? root.find(config.chapterSelector).filter((_, el) => $(el).is('a[href]'))
    : root.find('a[href]').filter((_, el) => {
        const $el = $(el);
        const text = ($el.text().trim() || $el.attr('title') || '').trim();
        return CHAPTER_TEXT.test(text) || CHAPTER_HREF.test($el.attr('href') ?? '');
      });

  // Drop anchors inside page chrome (sidebars/widgets). If that removes everything — a site whose TOC
  // *is* a widget — fall back to the full set. Single-pass, no re-parse.
  const inContent = raw.filter((_, el) => $(el).closest(CHROME_SELECTOR).length === 0);
  const anchors = inContent.length > 0 ? inContent : raw;

  const seen = new Set<string>();
  const chapters: TocChapter[] = [];

  anchors.each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href) return;
    // Unrendered client-side template stub: "{{chapter_slug}}"/"${…}", or a bare dotted-identifier
    // expression like "chapter.permalink" (an Alpine/Vue `x-bind:href` value that didn't render).
    if (/[{}]|\$\{/.test(href) || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(href.trim())) return;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(url)) return; // dedupe repeated anchors to the same chapter (e.g. Madara icon + title links)
    seen.add(url);

    const title = ($el.attr('title')?.trim() || $el.text().replace(/\s+/g, ' ').trim() || '').trim();
    const number = parseChapterNumber(title) ?? parseChapterNumber(url);

    const row = $el.closest('li, tr, article, div');
    const scope = row.length > 0 ? row : $el;
    let locked: boolean;
    if (config?.lockSelector) {
      locked = scope.is(config.lockSelector) || scope.find(config.lockSelector).length > 0;
    } else if (config?.lockText) {
      const text = scope.text().toLowerCase();
      locked = config.lockText.some((t) => text.includes(t.toLowerCase()));
    } else {
      locked = LOCK_CLASS.test($.html(scope)) || LOCK_TEXT.test(scope.text());
    }

    chapters.push({ url, title, number, access: locked ? 'LOCKED' : 'FREE' });
  });

  if (config?.slugFamilies && config.slugFamilies.length > 0) {
    const families = config.slugFamilies;
    return chapters.filter((c) => {
      let path: string;
      try {
        path = new URL(c.url).pathname;
      } catch {
        path = c.url;
      }
      return families.some((f) => path.includes(f));
    });
  }
  return chapters;
}

/** Seed a feed series' full history: feed items (guid preserved) with access upgraded from the TOC where they
 *  match, plus the TOC's older tail the feed window never showed. Matched by canonical URL. Falls back to just
 *  the feed items when the TOC under-reads (JS/CF page). */
export function mergeFeedAndToc(feedItems: FeedItem[], tocItems: TocChapter[]): FeedItem[] {
  const tocByUrl = new Map(tocItems.map((t) => [canonicalUrl(t.url), t]));
  const usedToc = new Set<string>();
  const merged: FeedItem[] = feedItems.map((f) => {
    const key = canonicalUrl(f.url);
    const t = tocByUrl.get(key);
    if (t) usedToc.add(key);
    return t ? { ...f, access: t.access } : f;
  });
  for (const t of tocItems) {
    const key = canonicalUrl(t.url);
    if (usedToc.has(key)) continue;
    usedToc.add(key);
    merged.push({ url: t.url, title: t.title, number: t.number, access: t.access });
  }
  return merged;
}

/** Stamp each chapter's `position` from the TOC's reading order (WP-35). Pure; unchanged (chapters returned
 *  as-is) when the TOC's numeric signal is too weak to trust a direction (`tocReadingOrder` → null). */
export function withReadingPositions(
  chapters: FeedItem[],
  toc: readonly { url: string; number: number | null }[],
): FeedItem[] {
  const order = tocReadingOrder(toc);
  if (!order) return chapters;
  return chapters.map((c) => ({ ...c, position: order.get(canonicalUrl(c.url)) ?? null }));
}

const MIN_NUMBERED = 3;
const DIRECTION_MAJORITY = 0.7;

/** Map each TOC chapter's canonical URL to a 0-based reading-order position (oldest = 0), inferring the
 *  TOC's direction from the chapter-number trend and reversing when it lists newest-first. Returns null
 *  when the numeric signal is too weak to trust (→ caller skips positioning). Pure. */
export function tocReadingOrder(toc: readonly { url: string; number: number | null }[]): Map<string, number> | null {
  const nums = toc.map((c) => c.number).filter((n): n is number => n != null);
  if (nums.length < MIN_NUMBERED) return null;
  let up = 0;
  let down = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! > nums[i - 1]!) up++;
    else if (nums[i]! < nums[i - 1]!) down++;
  }
  const total = up + down;
  if (total === 0) return null;
  const ascending = up / total >= DIRECTION_MAJORITY ? true : down / total >= DIRECTION_MAJORITY ? false : null;
  if (ascending === null) return null;

  const map = new Map<string, number>();
  const n = toc.length;
  toc.forEach((chapter, i) => map.set(canonicalUrl(chapter.url), ascending ? i : n - 1 - i));
  return map;
}
