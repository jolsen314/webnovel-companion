import { parseFeed } from '../../lib/feeds/parse';
import {
  discoverFeeds,
  guessFeedUrls,
  chooseSeriesMatch,
  fallbackSeriesMatch,
  filterBySeriesMatch,
  type SeriesMatch,
} from '../../lib/feeds/discover';
import { parseToc, mergeFeedAndToc, withReadingPositions } from '../../lib/feeds/pageWatch';
import type { FeedItem } from '../../lib/feeds/diff';
import type { PoliteResult } from '../../lib/feeds/fetch';
import { canonicalSeriesId } from '../../lib/dedup';

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
  canonicalId: string; // WP-39
}

export interface AddSeriesPorts {
  fetch: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
  findSeriesByCanonicalId: (canonicalId: string) => Promise<{ seriesId: string } | null>; // WP-39
}

export interface AddSeriesResult {
  seriesId: string;
  resolved: ResolvedSource;
  alreadyExisting: boolean; // WP-39
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

/** The resolved source before its dedup id is computed. */
type ResolvedCore = Omit<ResolvedSource, 'canonicalId'>;

/** Compute the dedup id, and create the series only if one with that id doesn't already exist. */
async function finalize(core: ResolvedCore, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const canonicalId = canonicalSeriesId({ feedUrl: core.feedUrl, sourceUrl: core.sourceUrl, match: core.match });
  const resolved: ResolvedSource = { ...core, canonicalId };
  const existing = await ports.findSeriesByCanonicalId(canonicalId);
  if (existing) return { seriesId: existing.seriesId, resolved, alreadyExisting: true };
  const { seriesId } = await ports.createSeries(resolved);
  return { seriesId, resolved, alreadyExisting: false };
}

export async function addSeries(input: AddSeriesInput, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const { url } = input;
  const host = new URL(url).host;

  const page = await ports.fetch(url);
  const pageOk = page.outcome === 'SUCCESS' && !page.notModified;

  // Candidate feeds: advertised <link alternate> if we could read the page, else
  // common WordPress guesses. We try guesses even when the page fetch FAILED —
  // Cloudflare frequently challenges the HTML page while `/feed/` still serves.
  const advertised = pageOk ? discoverFeeds(page.body, url).map((f) => f.url) : [];
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

  // A feed is reachable → track via FEED (works even if the page itself was blocked).
  if (feedUrl !== null && feedBody !== null) {
    const parsed = await parseFeed(feedBody);
    const usedGuesses = advertised.length === 0;
    const positive = chooseSeriesMatch(parsed.items, url);
    // A page-advertised feed is the series' own feed → trust WHOLE_FEED. A guessed
    // site-wide feed we can't isolate → a series-scoped guess that captures nothing
    // now but fills in when the series next publishes (WP-RC escalates if it never does).
    const match = positive ?? (usedGuesses ? fallbackSeriesMatch(parsed.items, url) : { type: 'WHOLE_FEED' });
    const feedChapters = filterBySeriesMatch(parsed.items, match);
    const toc = pageOk ? parseToc(page.body, url) : [];
    const chapters = pageOk ? withReadingPositions(mergeFeedAndToc(feedChapters, toc), toc) : feedChapters;
    const seriesTitle =
      input.title ??
      (positive?.type === 'CATEGORY'
        ? positive.value // exact per-novel category = the novel's name
        : match.type === 'WHOLE_FEED'
          ? (parsed.title ?? titleFromUrl(url)) // series' own feed → channel title is the novel
          : titleFromUrl(url)); // slug/path fallback → humanize the URL, not the site name
    const core: ResolvedCore = { seriesTitle, sourceUrl: url, host, feedUrl, type: 'FEED', match, chapters };
    return finalize(core, ports);
  }

  // No feed, but the page loads → page-watch mode. Seed from the TOC so the first
  // poll diffs against a known set instead of re-reporting the whole backlog.
  if (pageOk) {
    const toc = parseToc(page.body, url);
    const core: ResolvedCore = {
      seriesTitle: input.title ?? titleFromUrl(url),
      sourceUrl: url,
      host,
      feedUrl: null,
      type: 'PAGE_WATCH',
      match: { type: 'WHOLE_FEED' },
      chapters: withReadingPositions(toc, toc),
    };
    return finalize(core, ports);
  }

  // Neither the page nor any feed is reachable.
  throw new Error(
    `Couldn’t reach ${host} or find a feed for it — the site may be blocking automated requests (e.g. Cloudflare).`,
  );
}
