import { diffChapters, type FeedItem, type KnownChapter } from '../../lib/feeds/diff';
import { parseFeed } from '../../lib/feeds/parse';
import { parseToc } from '../../lib/feeds/pageWatch';
import { filterBySeriesMatch, type SeriesMatch } from '../../lib/feeds/discover';
import { step, type FailureType, type HealthState, type SourceHealth } from '../../lib/health';
import type { PoliteResult } from '../../lib/feeds/fetch';

/**
 * Poll orchestration: composes the (pure, tested) feed pipeline —
 * fetch → health → parse → filter → diff — behind injected ports, so the logic is
 * unit-tested with fakes here and bound to Prisma + `politeFetch` at the edge.
 */

/** The subset of a Source row the poller needs. */
export interface PollableSource {
  id: string;
  seriesId: string;
  /** FEED → parse as a feed + apply the series matcher; PAGE_WATCH → parse the TOC. */
  type: 'FEED' | 'PAGE_WATCH';
  /** PLAIN → `politeFetch`; RENDER → the headless renderer (WP-17b). */
  fetchMode: 'PLAIN' | 'RENDER';
  /** The URL to GET (feedUrl ?? url). */
  fetchUrl: string;
  match: SeriesMatch;
  etag: string | null;
  lastModified: string | null;
  // current health columns
  health: SourceHealth;
  consecutiveFailures: number;
  failureScore: number;
  lastFailureType: FailureType | null;
}

/** What a poll produced — persisted via ports, and returned for callers/tests. */
export interface PollEffects {
  sourceId: string;
  seriesId: string;
  health: HealthState;
  /** The fetch itself succeeded (200 or 304) — for `lastSuccessAt`, distinct from "no new chapters". */
  succeeded: boolean;
  notModified: boolean;
  newChapters: FeedItem[];
  etag: string | null;
  lastModified: string | null;
  /** Health transitioned INTO LIKELY_DOWN on this poll → fire a "source may be down" alert. */
  crossedDown: boolean;
  /** A plain page-watch under-read (≤5 chapters) and a renderer is available → switch to RENDER. */
  escalateToRender: boolean;
}

export interface PollPorts {
  fetch: (url: string, opts: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  /** Headless-render fetch (WP-17b). Absent → no renderer configured; RENDER falls back to plain. */
  renderFetch?: (url: string, opts: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
  loadStoredChapters: (seriesId: string) => Promise<KnownChapter[]>;
  applyPollEffects: (effects: PollEffects) => Promise<void>;
}

function toHealthState(s: PollableSource): HealthState {
  return {
    health: s.health,
    consecutiveFailures: s.consecutiveFailures,
    score: s.failureScore,
    lastFailureType: s.lastFailureType,
  };
}

/** A plain page-watch yielding at most this many chapters reads as "the list didn't render". */
const RENDER_ESCALATION_MAX = 5;

export async function pollSource(src: PollableSource, ports: PollPorts): Promise<PollEffects> {
  // RENDER sources use the headless renderer when one is configured; otherwise fall back to plain.
  const fetcher = src.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch;
  const res = await fetcher(src.fetchUrl, { etag: src.etag, lastModified: src.lastModified });
  const health = step(toHealthState(src), res.outcome);

  let newChapters: FeedItem[] = [];
  let notModified = false;
  let escalateToRender = false;
  let etag = src.etag;
  let lastModified = src.lastModified;

  if (res.outcome === 'SUCCESS') {
    if (res.notModified) {
      notModified = true;
    } else {
      etag = res.etag ?? etag;
      lastModified = res.lastModified ?? lastModified;
      // FEED: parse the feed and isolate this series. PAGE_WATCH: parse the TOC
      // (already series-scoped) — its chapters carry FREE/LOCKED access.
      let mine: FeedItem[];
      if (src.type === 'PAGE_WATCH') {
        mine = parseToc(res.body, src.fetchUrl);
        // A plain page-watch returning almost nothing is usually a JS-rendered TOC that
        // didn't render — escalate to the headless renderer, if one is available.
        if (ports.renderFetch && src.fetchMode === 'PLAIN' && mine.length <= RENDER_ESCALATION_MAX) {
          escalateToRender = true;
        }
      } else {
        const parsed = await parseFeed(res.body);
        mine = filterBySeriesMatch(parsed.items, src.match);
      }
      const stored = await ports.loadStoredChapters(src.seriesId);
      newChapters = diffChapters(stored, mine).new;
    }
  }

  const effects: PollEffects = {
    sourceId: src.id,
    seriesId: src.seriesId,
    health,
    succeeded: res.outcome === 'SUCCESS',
    notModified,
    newChapters,
    etag,
    lastModified,
    crossedDown: src.health !== 'LIKELY_DOWN' && health.health === 'LIKELY_DOWN',
    escalateToRender,
  };
  await ports.applyPollEffects(effects);
  return effects;
}

export async function pollAllSources(
  ports: PollPorts & { loadActiveSources: () => Promise<PollableSource[]> },
): Promise<PollEffects[]> {
  const sources = await ports.loadActiveSources();
  const effects: PollEffects[] = [];
  for (const src of sources) effects.push(await pollSource(src, ports));
  return effects;
}
