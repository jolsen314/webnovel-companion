import { diffChapters, type FeedItem, type KnownChapter } from '../../lib/feeds/diff';
import { parseFeed } from '../../lib/feeds/parse';
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
}

export interface PollPorts {
  fetch: (url: string, opts: { etag?: string | null; lastModified?: string | null }) => Promise<PoliteResult>;
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

export async function pollSource(src: PollableSource, ports: PollPorts): Promise<PollEffects> {
  const res = await ports.fetch(src.fetchUrl, { etag: src.etag, lastModified: src.lastModified });
  const health = step(toHealthState(src), res.outcome);

  let newChapters: FeedItem[] = [];
  let notModified = false;
  let etag = src.etag;
  let lastModified = src.lastModified;

  if (res.outcome === 'SUCCESS') {
    if (res.notModified) {
      notModified = true;
    } else {
      etag = res.etag ?? etag;
      lastModified = res.lastModified ?? lastModified;
      const parsed = await parseFeed(res.body);
      const mine = filterBySeriesMatch(parsed.items, src.match);
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
