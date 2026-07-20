import { parseFeed } from '../../lib/feeds/parse';
import {
  discoverFeeds,
  guessFeedUrls,
  chooseSeriesMatch,
  filterBySeriesMatch,
  type SeriesMatch,
} from '../../lib/feeds/discover';
import type { FeedItem } from '../../lib/feeds/diff';
import type { PoliteResult } from '../../lib/feeds/fetch';

/**
 * Add-time source resolution: given a URL the user pastes, discover a feed (or fall
 * back to page-watch), decide how to isolate this series, and hand a resolved source
 * to persistence. Composed from the pure feed pipeline behind injected ports.
 */

export interface AddSeriesInput {
  url: string;
  /** Optional user-supplied title; otherwise derived from the feed or the URL. */
  title?: string;
}

export interface ResolvedSource {
  seriesTitle: string;
  sourceUrl: string;
  host: string;
  feedUrl: string | null;
  type: 'FEED' | 'PAGE_WATCH';
  match: SeriesMatch;
  chapters: FeedItem[];
}

export interface AddSeriesPorts {
  fetch: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
}

export interface AddSeriesResult {
  seriesId: string;
  resolved: ResolvedSource;
}

function looksLikeFeed(body: string): boolean {
  return /^\s*(?:<\?xml|<rss\b|<feed\b)/i.test(body.slice(0, 500));
}

/** Best-effort human title from a URL's last path segment (fallback only). */
function titleFromUrl(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? new URL(url).host;
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

export async function addSeries(input: AddSeriesInput, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const { url } = input;
  const host = new URL(url).host;

  const page = await ports.fetch(url);
  if (page.outcome !== 'SUCCESS') {
    throw new Error(`Could not reach ${url} to add it (${page.outcome}).`);
  }

  // Candidate feeds: advertised <link alternate>, else common WordPress guesses.
  const advertised = discoverFeeds(page.body ?? '', url).map((f) => f.url);
  const candidates = advertised.length > 0 ? advertised : guessFeedUrls(url);

  let feedUrl: string | null = null;
  let feedBody: string | null = null;
  for (const candidate of candidates) {
    const r = await ports.fetch(candidate);
    if (r.outcome === 'SUCCESS' && !r.notModified && looksLikeFeed(r.body)) {
      feedUrl = candidate;
      feedBody = r.body;
      break;
    }
  }

  // No feed found → page-watch mode (TOC chapter extraction is WP-17).
  if (feedUrl === null || feedBody === null) {
    const resolved: ResolvedSource = {
      seriesTitle: input.title ?? titleFromUrl(url),
      sourceUrl: url,
      host,
      feedUrl: null,
      type: 'PAGE_WATCH',
      match: { type: 'WHOLE_FEED' },
      chapters: [],
    };
    const { seriesId } = await ports.createSeries(resolved);
    return { seriesId, resolved };
  }

  const parsed = await parseFeed(feedBody);
  const match = chooseSeriesMatch(parsed.items, url);
  const chapters = filterBySeriesMatch(parsed.items, match);
  const resolved: ResolvedSource = {
    seriesTitle: input.title ?? parsed.title ?? titleFromUrl(url),
    sourceUrl: url,
    host,
    feedUrl,
    type: 'FEED',
    match,
    chapters,
  };
  const { seriesId } = await ports.createSeries(resolved);
  return { seriesId, resolved };
}
