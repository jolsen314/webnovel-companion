import Parser from 'rss-parser';
import type { FeedItem } from './diff';

/**
 * Feed parsing: turn raw RSS/Atom XML into our source-agnostic FeedItem shape,
 * ready for `diffChapters`. Pure (string in, structured out) — the HTTP fetch,
 * conditional GET, and Cloudflare handling live in the fetcher, not here.
 *
 * rss-parser handles the real-world messiness the spike surfaced: XML entity
 * decoding in URLs (`&#038;` → `&`), CDATA, and both RSS `<guid>` and Atom `<id>`.
 */

export interface ParsedFeed {
  title: string | null;
  items: FeedItem[];
}

const parser = new Parser();

/** rss-parser categories are usually strings but can be objects ({ _, $ }); normalize to strings. */
function normalizeCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [];
  return categories
    .map((c) => (typeof c === 'string' ? c : ((c as { _?: string })?._ ?? '')))
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Best-effort chapter number from a title. Looks for a chapter/episode keyword
 * followed by a number (decimals allowed), e.g. "Chapter 79", "Ch90", "Ep. 12".
 * Returns null when no such number is present — this is a hint, NOT an identity
 * or a guaranteed-contiguous sequence (see CONTEXT.md "chapter number").
 */
export function parseChapterNumber(title: string): number | null {
  // Allow a hyphen/underscore separator too, so URL slugs like "…-chapter-7" parse.
  const m = /\b(?:chapter|chap|ch|episode|ep)[\s._#-]*(\d+(?:\.\d+)?)/i.exec(title);
  return m ? parseFloat(m[1]!) : null;
}

export async function parseFeed(xml: string): Promise<ParsedFeed> {
  const feed = await parser.parseString(xml);
  const items: FeedItem[] = feed.items.map((it) => ({
    // RSS uses <guid>; Atom uses <id> (rss-parser exposes it as `id`, not in its types).
    guid: it.guid ?? (it as { id?: string }).id ?? undefined,
    url: it.link ?? '',
    title: it.title ?? '',
    number: parseChapterNumber(it.title ?? ''),
    publishedAt: it.isoDate ? new Date(it.isoDate) : null,
    categories: normalizeCategories(it.categories),
  }));
  return { title: feed.title ?? null, items };
}
