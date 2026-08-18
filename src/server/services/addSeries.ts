import { parseFeed } from '../../lib/feeds/parse';
import {
  discoverFeeds,
  guessFeedUrls,
  chooseSeriesMatch,
  fallbackSeriesMatch,
  filterBySeriesMatch,
  findTocUrl,
  type SeriesMatch,
} from '../../lib/feeds/discover';
import { extractSeriesTitle, matchesSiteName } from '../../lib/feeds/title';
import { parseToc, mergeFeedAndToc, withReadingPositions } from '../../lib/feeds/pageWatch';
import type { FeedItem } from '../../lib/feeds/diff';
import type { PoliteResult } from '../../lib/feeds/fetch';
import { canonicalSeriesId, findSimilarTitle } from '../../lib/dedup';
import { RENDER_ESCALATION_MAX } from './poll';
import { probeForApi } from '../../lib/feeds/apiProbe';
import { parseApiChapters, type ApiDescriptor } from '../../lib/feeds/apiAdapter';

/**
 * Add-time source resolution: given a URL the user pastes, discover a feed (or fall
 * back to page-watch), decide how to isolate this series, and hand a resolved source
 * to persistence. Composed from the pure feed pipeline behind injected ports.
 */

export interface AddSeriesInput {
  url: string;
  /** Optional user-supplied title; otherwise derived from the feed or the URL. */
  title?: string;
  /** WP-50: user confirmed a link-only add — skip resolution and create directly. */
  allowLinkOnly?: boolean;
}

export interface ResolvedSource {
  seriesTitle: string;
  sourceUrl: string;
  host: string;
  feedUrl: string | null;
  tocUrl: string | null; // WP-37: separate chapter-TOC page, when discoverable
  type: 'FEED' | 'PAGE_WATCH' | 'API';
  apiUrl: string | null; // WP-45: the chapter-data endpoint when type === 'API'
  apiMap: ApiDescriptor | null; // WP-45: per-source field descriptor when type === 'API'
  linkOnly: boolean; // WP-50: link-only entry — created via allowLinkOnly, excluded from polling
  fetchMode: 'PLAIN' | 'RENDER'; // WP-46: RENDER when the source needs our headless renderer
  match: SeriesMatch;
  chapters: FeedItem[];
  canonicalId: string; // WP-39
}

export interface AddSeriesPorts {
  fetch: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  render?: (url: string, opts?: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>; // WP-46: headless renderer, last resort
  createSeries: (resolved: ResolvedSource) => Promise<{ seriesId: string }>;
  findSeriesByCanonicalId: (canonicalId: string) => Promise<{ seriesId: string } | null>; // WP-39
  listExistingSeries: () => Promise<{ id: string; title: string }[]>; // WP-39b: for the similar-title annotate
}

export interface AddSeriesCreated {
  kind: 'created';
  seriesId: string;
  resolved: ResolvedSource;
  alreadyExisting: boolean; // WP-39
  similarTo?: { id: string; title: string } | null; // WP-39b (create branch only)
}

/** WP-50: resolution couldn't confidently create a source — surface a reason so the caller can
 *  offer the user a confirmed link-only add instead of throwing or silently creating a dead entry. */
export interface AddSeriesNeedsConfirm {
  kind: 'needsConfirm';
  reason: 'blocked' | 'no-chapters';
  suggestedTitle: string;
  url: string;
}

export type AddSeriesResult = AddSeriesCreated | AddSeriesNeedsConfirm;

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
async function finalize(core: ResolvedCore, ports: AddSeriesPorts): Promise<AddSeriesCreated> {
  const canonicalId = canonicalSeriesId({ feedUrl: core.feedUrl, tocUrl: core.tocUrl, sourceUrl: core.sourceUrl, match: core.match });
  const resolved: ResolvedSource = { ...core, canonicalId };
  const existing = await ports.findSeriesByCanonicalId(canonicalId);
  if (existing) return { kind: 'created', seriesId: existing.seriesId, resolved, alreadyExisting: true };
  const similarTo = findSimilarTitle(resolved.seriesTitle, await ports.listExistingSeries());
  const { seriesId } = await ports.createSeries(resolved);
  return { kind: 'created', seriesId, resolved, alreadyExisting: false, similarTo };
}

export async function addSeries(input: AddSeriesInput, ports: AddSeriesPorts): Promise<AddSeriesResult> {
  const { url } = input;
  const host = new URL(url).host;

  // WP-50: confirmed link-only add — create directly, no re-fetch/re-render.
  if (input.allowLinkOnly) {
    const core: ResolvedCore = {
      seriesTitle: input.title ?? titleFromUrl(url),
      sourceUrl: url, host, feedUrl: null, tocUrl: null, apiUrl: null, apiMap: null,
      type: 'PAGE_WATCH', fetchMode: 'PLAIN', match: { type: 'WHOLE_FEED' },
      chapters: [], linkOnly: true,
    };
    return finalize(core, ports);
  }

  /** Resolve a fetched page into a FEED or PAGE_WATCH source, or null when neither a feed nor
   *  the page itself is reachable. `bodyMode` records whether `pageResult` came from a headless
   *  render, so a PAGE_WATCH resolution can persist RENDER (a feed is always fetched plainly). */
  const resolveFrom = async (
    pageResult: PoliteResult,
    bodyMode: 'PLAIN' | 'RENDER',
  ): Promise<AddSeriesResult | null> => {
    const pageOk = pageResult.outcome === 'SUCCESS' && !pageResult.notModified;
    const pageBody = pageOk ? pageResult.body : '';
    const pageTitle = pageOk ? extractSeriesTitle(pageBody, { siteName: host }) : null;
    // Parse the page's own chapter list once (empty when the page didn't load). Reused by the
    // feed↔TOC merge, the WP-49 divert check, and the page-watch seed below.
    const pageToc = pageOk ? parseToc(pageBody, url) : [];

    // WP-45: API-first. If the (plainly-fetched) page reveals a chapter data API, read it
    // directly — the complete list with access, no feed and no render. Only on the PLAIN pass:
    // a CF-gated API reached via the RENDER pass needs the render transport (WP-45b), out of scope.
    if (pageOk && bodyMode === 'PLAIN') {
      const api = probeForApi(pageBody, url);
      if (api) {
        const apiRes = await ports.fetch(api.apiUrl);
        if (apiRes.outcome === 'SUCCESS' && !apiRes.notModified) {
          const apiChapters = parseApiChapters(apiRes.body, api.descriptor, api.apiUrl);
          if (apiChapters.length > 0) {
            const core: ResolvedCore = {
              seriesTitle: input.title ?? pageTitle ?? titleFromUrl(url),
              sourceUrl: url,
              host,
              feedUrl: null,
              tocUrl: null,
              apiUrl: api.apiUrl,
              apiMap: api.descriptor,
              type: 'API',
              linkOnly: false,
              fetchMode: 'PLAIN',
              match: { type: 'WHOLE_FEED' },
              chapters: withReadingPositions(apiChapters, apiChapters),
            };
            return finalize(core, ports);
          }
        }
      }
    }

    // Candidate feeds: advertised <link alternate> if we could read the page, else common
    // WordPress/Blogger guesses. Guesses are tried even when the page fetch FAILED —
    // Cloudflare frequently challenges the HTML page while `/feed/` still serves. But only on the
    // PLAIN pass: `guessFeedUrls` is a pure function of the URL, so on the RENDER pass (reached
    // only after the plain pass already tried and failed those same guesses) re-guessing is
    // wasted — only an advertised feed in the rendered body is new information worth fetching.
    const advertised = pageOk ? discoverFeeds(pageBody, url).map((f) => f.url) : [];
    const candidates = advertised.length > 0 ? advertised : bodyMode === 'PLAIN' ? guessFeedUrls(url) : [];

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

    // A feed is reachable → track via FEED (works even if the page itself was blocked). A feed
    // is fetched plainly at poll time (render never helps XML), so FEED is always PLAIN.
    if (feedUrl !== null && feedBody !== null) {
      const parsed = await parseFeed(feedBody);
      const usedGuesses = advertised.length === 0;
      const positive = chooseSeriesMatch(parsed.items, url);
      // WP-49: an ADVERTISED feed we can't positively isolate is almost always the site-wide,
      // multi-novel `/feed/`. WHOLE_FEED-ing it ingests every other novel's chapters. If the page
      // is itself a real chapter list, prefer page-watch (series-scoped) over the contaminated
      // feed — fall through to the PAGE_WATCH branch below. A guessed feed, or a page that isn't
      // a real TOC, keeps today's behavior.
      const cantIsolateAdvertised = positive === null && !usedGuesses;
      // WP-34: a readable page TOC that shows LOCKED chapters → prefer page-watch (track unlocks),
      // even when the feed is isolable — the unlock event lives only in the TOC, not the feed.
      const tocHasLocks = pageToc.some((c) => c.access === 'LOCKED');
      const divertToPageWatch = (cantIsolateAdvertised && pageToc.length > RENDER_ESCALATION_MAX) || tocHasLocks;
      if (!divertToPageWatch) {
        const match = positive ?? (usedGuesses ? fallbackSeriesMatch(parsed.items, url) : { type: 'WHOLE_FEED' });
        const feedChapters = filterBySeriesMatch(parsed.items, match);
        const toc = pageToc;
        const chapters = pageOk ? withReadingPositions(mergeFeedAndToc(feedChapters, toc), toc) : feedChapters;
        const seriesTitle =
          input.title ??
          pageTitle ??
          (positive?.type === 'CATEGORY'
            ? positive.value
            : match.type === 'WHOLE_FEED'
              ? (parsed.title != null && !matchesSiteName(parsed.title, host) ? parsed.title : titleFromUrl(url))
              : titleFromUrl(url));
        const tocUrl = pageOk ? findTocUrl(pageBody, url) : null;
        const core: ResolvedCore = {
          seriesTitle, sourceUrl: url, host, feedUrl, tocUrl, apiUrl: null, apiMap: null,
          type: 'FEED', linkOnly: false, fetchMode: 'PLAIN', match, chapters,
        };
        return finalize(core, ports);
      }
      // else: advertised multi-novel feed we can't isolate + the page is a real TOC → page-watch it.
    }

    // No feed, but the page loads → page-watch mode. Seed from the TOC so the first poll diffs
    // against a known set instead of re-reporting the whole backlog.
    if (pageOk) {
      const tocUrl = findTocUrl(pageBody, url);
      let toc = pageToc;
      let fetchMode: 'PLAIN' | 'RENDER' = bodyMode;
      // Under-fetch: a plain TOC that reads almost nothing is usually a JS-rendered list that
      // didn't render. Render it and keep the rendered chapters only if there are strictly more.
      // Skipped when we already rendered (bodyMode === 'RENDER') — no double render.
      if (bodyMode === 'PLAIN' && ports.render && toc.length <= RENDER_ESCALATION_MAX) {
        const rendered = await ports.render(tocUrl ?? url);
        if (rendered.outcome === 'SUCCESS' && !rendered.notModified) {
          const rtoc = parseToc(rendered.body, tocUrl ?? url);
          if (rtoc.length > toc.length) {
            toc = rtoc;
            fetchMode = 'RENDER';
          }
        }
      }
      // A landing page with neither its own chapter links NOR a discoverable TOC page has nothing
      // to track — needsConfirm. A discoverable tocUrl (even with 0 chapters read here) is still a
      // legit page-watch: it creates with 0 chapters now and fills in on the first backfillFromToc,
      // exactly as before WP-50 — only genuinely nothing-to-track pages are blocked.
      if (toc.length === 0 && tocUrl === null) {
        return { kind: 'needsConfirm', reason: 'no-chapters', suggestedTitle: pageTitle ?? titleFromUrl(url), url };
      }
      const core: ResolvedCore = {
        seriesTitle: input.title ?? pageTitle ?? titleFromUrl(url),
        sourceUrl: url,
        host,
        feedUrl: null,
        tocUrl,
        apiUrl: null,
        apiMap: null,
        type: 'PAGE_WATCH',
        linkOnly: false,
        fetchMode,
        match: { type: 'WHOLE_FEED' },
        chapters: withReadingPositions(toc, toc),
      };
      return finalize(core, ports);
    }

    return null;
  };

  const plain = await ports.fetch(url);
  const resolved = await resolveFrom(plain, 'PLAIN');
  if (resolved) return resolved;

  // Hard-fail: neither the page nor any feed was reachable plainly. Our own render clears
  // Cloudflare's JS managed challenge (WP-40 spike), so try it once before giving up.
  if (ports.render) {
    const rendered = await ports.render(url);
    if (rendered.outcome === 'SUCCESS' && !rendered.notModified) {
      const viaRender = await resolveFrom(rendered, 'RENDER');
      if (viaRender) return viaRender;
    }
  }

  // Hard-fail: neither page nor feed reachable (even via render) → blocked. Let the user confirm a link-only add.
  return { kind: 'needsConfirm', reason: 'blocked', suggestedTitle: titleFromUrl(url), url };
}
