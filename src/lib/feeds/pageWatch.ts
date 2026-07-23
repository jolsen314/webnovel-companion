import * as cheerio from 'cheerio';
import { parseChapterNumber } from './parse';

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
  /** If this selector matches within a chapter's row, the chapter is LOCKED. */
  lockSelector?: string;
  /** Text signals (case-insensitive) that mark a chapter LOCKED. */
  lockText?: string[];
}

const CHAPTER_TEXT = /chapter|\bch\.?\s*\d|\bep\.?\s*\d|第\s*\d+\s*[章话]/i;
const CHAPTER_HREF = /chapter|\/ch(?:apter)?[-_/]?\d|\/ep[-_/]?\d|\/v\d+\/\d+/i;
const LOCK_CLASS = /class=["'][^"']*(?:lock|premium|vip|coin)[^"']*["']|fa-lock/i;
const LOCK_TEXT = /locked|premium|\bvip\b|\bcoins?\b|🔒|🔐|unlock/i;

export function parseToc(html: string, baseUrl: string, config?: SiteTocConfig): TocChapter[] {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const anchors = config
    ? $(config.chapterSelector).filter((_, el) => $(el).is('a[href]'))
    : $('a[href]').filter((_, el) => {
        const $el = $(el);
        const text = ($el.text().trim() || $el.attr('title') || '').trim();
        return CHAPTER_TEXT.test(text) || CHAPTER_HREF.test($el.attr('href') ?? '');
      });

  const seen = new Set<string>();
  const chapters: TocChapter[] = [];

  anchors.each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href) return;
    if (/[{}]|\$\{/.test(href)) return; // unrendered client-side template stub (e.g. "…/{{chapter_slug}}/")
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

  return chapters;
}
