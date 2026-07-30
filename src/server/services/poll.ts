import { diffChapters, type FeedItem, type KnownChapter } from '../../lib/feeds/diff';
import { parseFeed } from '../../lib/feeds/parse';
import { parseToc } from '../../lib/feeds/pageWatch';
import { filterBySeriesMatch, type SeriesMatch } from '../../lib/feeds/discover';
import { step, type FailureType, type HealthState, type SourceHealth } from '../../lib/health';
import { parseRetryAfter, type PoliteResult } from '../../lib/feeds/fetch';

/**
 * Poll orchestration: composes the (pure, tested) feed pipeline —
 * fetch → health → parse → filter → diff — behind injected ports, so the logic is
 * unit-tested with fakes here and bound to Prisma + `politeFetch` at the edge.
 */

/** Minimum minutes between polls of one host — the floor that keeps a frequent external
 *  trigger polite. Polls fired more often than this per host simply no-op. */
export const MIN_POLL_INTERVAL_MINUTES = 15;

/** Whether to skip a host this cycle: backoff (429/Retry-After) first, then the min-interval
 *  cap. Both compare against pre-run state. Pure. */
export function hostGate(args: {
  hostLastCheckedAt: Date | null;
  hostBackoffUntil: Date | null;
  now: Date;
  minIntervalMs: number;
}): { skip: boolean; reason: 'ok' | 'min-interval' | 'backoff' } {
  const { hostLastCheckedAt, hostBackoffUntil, now, minIntervalMs } = args;
  if (hostBackoffUntil && hostBackoffUntil.getTime() > now.getTime()) return { skip: true, reason: 'backoff' };
  if (hostLastCheckedAt && now.getTime() - hostLastCheckedAt.getTime() < minIntervalMs) {
    return { skip: true, reason: 'min-interval' };
  }
  return { skip: false, reason: 'ok' };
}

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
  /** Host (for per-host politeness gating). */
  host: string;
  /** Last poll attempt (any outcome) — drives the min-interval cap. Null = never polled. */
  lastCheckedAt: Date | null;
  /** Skip this host until this time (429/Retry-After). Null = no backoff. */
  backoffUntil: Date | null;
}

/** A group of sources sharing the same (fetchMode, fetchUrl) — fetched once to satisfy all. */
export interface PollGroup {
  key: string;
  fetchMode: PollableSource['fetchMode'];
  fetchUrl: string;
  host: string;
  sources: PollableSource[];
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
  /** Already-seen chapters that flipped LOCKED→FREE this poll (the "now free" event). */
  becameFree: KnownChapter[];
  /** Already-seen chapters whose access was learned (UNKNOWN→FREE/LOCKED) from a TOC read. Silent. */
  accessReconciled: KnownChapter[];
  etag: string | null;
  lastModified: string | null;
  /** Health transitioned INTO LIKELY_DOWN on this poll → fire a "source may be down" alert. */
  crossedDown: boolean;
  /** A plain page-watch under-read (≤5 chapters) and a renderer is available → switch to RENDER. */
  escalateToRender: boolean;
  /** Skip this host until this time (429/Retry-After on this poll). Null clears any prior backoff. */
  backoffUntil?: Date | null;
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

/** The host actually hit by a fetch: derived from `fetchUrl`, since the page a source is
 *  *stored* under (`host`) and the feed it's *fetched* from can live on different domains
 *  (e.g. FeedBurner or another proxy in front of the page). Falls back to the stored `host`
 *  if `fetchUrl` doesn't parse as a URL. Pure. */
function fetchedHost(fetchUrl: string, fallbackHost: string): string {
  try {
    return new URL(fetchUrl).host;
  } catch {
    return fallbackHost;
  }
}

/** Group active sources so each distinct (fetchMode, fetchUrl) is fetched once. `host` on the
 *  group is the FETCHED host (see `fetchedHost`) — what politeness gating must key on, since
 *  that's the domain actually hit for this group. Pure. */
export function groupPollSources(sources: PollableSource[]): PollGroup[] {
  const byKey = new Map<string, PollGroup>();
  for (const s of sources) {
    const key = `${s.fetchMode}::${s.fetchUrl}`;
    const g = byKey.get(key);
    if (g) g.sources.push(s);
    else
      byKey.set(key, {
        key,
        fetchMode: s.fetchMode,
        fetchUrl: s.fetchUrl,
        host: fetchedHost(s.fetchUrl, s.host),
        sources: [s],
      });
  }
  return [...byKey.values()];
}

/** Validators the whole group agrees on: prefer a shared non-null etag, else a shared
 *  non-null lastModified, else none (full fetch). Any null/divergence → full. Pure. */
export function chooseConditionalState(
  sources: PollableSource[],
): { etag: string | null; lastModified: string | null } {
  const allSame = <T>(vals: (T | null)[]): T | null =>
    vals.length > 0 && vals.every((v) => v != null && v === vals[0]) ? (vals[0] as T) : null;
  const etag = allSame(sources.map((s) => s.etag));
  if (etag) return { etag, lastModified: null };
  const lastModified = allSame(sources.map((s) => s.lastModified));
  return { etag: null, lastModified };
}

/** A plain page-watch yielding at most this many chapters reads as "the list didn't render". */
const RENDER_ESCALATION_MAX = 5;

/** The post-fetch half of a poll: given a `PoliteResult` already fetched for `src` (solo or
 *  shared across a `PollGroup`), apply health scoring and — on a fresh SUCCESS — parse, filter
 *  by series, and diff against stored chapters. Pure aside from `ports.loadStoredChapters`. */
export async function processFetched(
  src: PollableSource,
  res: PoliteResult,
  retryAfterAt: Date | null,
  ports: PollPorts,
): Promise<PollEffects> {
  const health = step(toHealthState(src), res.outcome);

  let newChapters: FeedItem[] = [];
  let becameFree: KnownChapter[] = [];
  let accessReconciled: KnownChapter[] = [];
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
      const diff = diffChapters(stored, mine);
      newChapters = diff.new;
      becameFree = diff.becameFree;
      accessReconciled = diff.accessReconciled;
    }
  }

  return {
    sourceId: src.id,
    seriesId: src.seriesId,
    health,
    succeeded: res.outcome === 'SUCCESS',
    notModified,
    newChapters,
    becameFree,
    accessReconciled,
    etag,
    lastModified,
    crossedDown: src.health !== 'LIKELY_DOWN' && health.health === 'LIKELY_DOWN',
    escalateToRender,
    backoffUntil: retryAfterAt,
  };
}

/** Poll a single source in isolation: fetch once for it alone, then `processFetched` + persist.
 *  Kept for direct unit coverage of the fetch→health→parse→diff pipeline; the feed-centric
 *  `pollAllSources` below fetches once per group and calls `processFetched` itself instead. */
export async function pollSource(src: PollableSource, ports: PollPorts): Promise<PollEffects> {
  // RENDER sources use the headless renderer when one is configured; otherwise fall back to plain.
  const fetcher = src.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch;
  const res = await fetcher(src.fetchUrl, { etag: src.etag, lastModified: src.lastModified });
  const retryAfterAt = parseRetryAfter(res.retryAfter ?? null, new Date());
  const effects = await processFetched(src, res, retryAfterAt, ports);
  await ports.applyPollEffects(effects);
  return effects;
}

/** Later of two nullable dates, or null if both are null. Pure. */
function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** Poll every active source, grouped by shared (fetchMode, fetchUrl) so a feed with several
 *  tracked series is fetched once and fanned out to each. Gated per host: a host in backoff
 *  (429/Retry-After) or polled within `MIN_POLL_INTERVAL_MINUTES` is skipped silently this
 *  cycle — `lastCheckedAt` is untouched, so it's retried next cycle. */
export async function pollAllSources(
  ports: PollPorts & { loadActiveSources: () => Promise<PollableSource[]> },
  now: Date = new Date(),
): Promise<PollEffects[]> {
  const sources = await ports.loadActiveSources();

  // Pre-run per-host aggregates (max lastCheckedAt / backoffUntil across the host's sources).
  // Gating compares against this snapshot, not against anything written during this run — a
  // 429 on one feed group mid-run does NOT gate a different feed group on the same host until
  // the next cycle. Intentional: simpler and safer than re-aggregating live (no risk of a group
  // processed early in iteration order affecting one processed later within the same run).
  // Keyed by the FETCHED host (see `fetchedHost`), not the stored page host — a group is
  // fetched at `fetchUrl`, so that's the domain the gate must throttle consistently with.
  const hostLast = new Map<string, Date | null>();
  const hostBackoff = new Map<string, Date | null>();
  for (const s of sources) {
    const host = fetchedHost(s.fetchUrl, s.host);
    hostLast.set(host, maxDate(hostLast.get(host) ?? null, s.lastCheckedAt));
    hostBackoff.set(host, maxDate(hostBackoff.get(host) ?? null, s.backoffUntil));
  }
  const minIntervalMs = MIN_POLL_INTERVAL_MINUTES * 60_000;

  const effects: PollEffects[] = [];
  for (const group of groupPollSources(sources)) {
    const gate = hostGate({
      hostLastCheckedAt: hostLast.get(group.host) ?? null,
      hostBackoffUntil: hostBackoff.get(group.host) ?? null,
      now,
      minIntervalMs,
    });
    if (gate.skip) continue; // silent no-op; lastCheckedAt untouched

    const cond = chooseConditionalState(group.sources);
    const fetcher = group.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch;
    const res = await fetcher(group.fetchUrl, { etag: cond.etag, lastModified: cond.lastModified });
    const retryAfterAt = parseRetryAfter(res.retryAfter ?? null, now);

    for (const src of group.sources) {
      const e = await processFetched(src, res, retryAfterAt, ports);
      await ports.applyPollEffects(e);
      effects.push(e);
    }
  }
  return effects;
}
