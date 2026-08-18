import { diffChapters, type FeedItem, type KnownChapter } from '../../lib/feeds/diff';
import { parseFeed } from '../../lib/feeds/parse';
import { parseToc } from '../../lib/feeds/pageWatch';
import { filterBySeriesMatch, type SeriesMatch } from '../../lib/feeds/discover';
import { step, type FailureType, type HealthState, type SourceHealth } from '../../lib/health';
import { parseRetryAfter, type PoliteResult } from '../../lib/feeds/fetch';
import type { SeriesStatus } from '../../lib/series';

/**
 * Poll orchestration: composes the (pure, tested) feed pipeline —
 * fetch → health → parse → filter → diff — behind injected ports, so the logic is
 * unit-tested with fakes here and bound to Prisma + `politeFetch` at the edge.
 */

/** Minimum minutes between polls of one host — the floor that keeps a frequent external
 *  trigger polite. Polls fired more often than this per host simply no-op. */
export const MIN_POLL_INTERVAL_MINUTES = 15;

/** Wall-clock budget for one `pollAllSources` run. The cron function's `maxDuration` is 300s
 *  (Vercel Hobby's ceiling); this leaves ~30s headroom for the push + schedule steps and the
 *  response. The loop stops *starting* new group fetches once the run can't finish one within
 *  budget — so a run degrades gracefully (drops its freshest tail, which rotation re-polls first
 *  next run) instead of being killed mid-loop. Tunable against real poll logs. WP-41. */
export const POLL_BUDGET_MS = 270_000;

/** Worst-case cost estimates used to decide whether the *next* group fits the remaining budget.
 *  RENDER can't 304 — every poll is a full headless render (~5–15s); PLAIN is a conditional GET
 *  (mostly fast 304s) plus parse. Conservative on purpose: overestimating skips a borderline
 *  group (rotation catches it next run) rather than risking an over-budget kill. WP-41. */
export const RENDER_COST_MS = 15_000;
export const PLAIN_COST_MS = 5_000;

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

/** Which active sources a poll run considers. 'all' = the full daily superset; 'plain' = only the
 *  cheap, conditional-GET-friendly FEED+PLAIN tier the frequent external trigger polls (WP-43). */
export type PollTier = 'all' | 'plain';

/** Prisma `where` selecting the sources for a tier. Pure — no Prisma import; the returned literal is
 *  structurally a `Prisma.SourceWhereInput`. WP-43. */
export function sourceTierWhere(tier: PollTier): { isActive: true; type?: 'FEED'; fetchMode?: 'PLAIN' } {
  return tier === 'plain' ? { isActive: true, type: 'FEED', fetchMode: 'PLAIN' } : { isActive: true };
}

/** Re-exported from `lib/series` (the single source of truth) so poll's existing consumers
 *  keep importing `SeriesStatus` from here. WP-27a. */
export type { SeriesStatus };

/** Minutes between eligible polls per shelf status. 0 = every run; null = never auto-poll
 *  (re-enters only when the reader changes the status, e.g. promote to READING). WP-27a. */
const STATUS_CADENCE_MINUTES: Record<SeriesStatus, number | null> = {
  READING: 0,
  PLANNED: 7 * 24 * 60, // weekly — a plan-to-read backlog doesn't need daily freshness
  PAUSED: null, // on-promote only
  COMPLETED: null,
  DROPPED: null,
};

/** Statuses worth loading for a poll at all — derived from the cadence map (the non-null ones),
 *  so the map stays the single source of truth. Used to pre-filter the active-sources query. */
export const POLLABLE_STATUSES = (Object.keys(STATUS_CADENCE_MINUTES) as SeriesStatus[])
  .filter((s) => STATUS_CADENCE_MINUTES[s] !== null);

/** Whether to skip a source this cycle based on its series' shelf status + cadence. `status-skip`
 *  = the status never auto-polls; `status-cadence` = polled within its cadence window. Pure. WP-27a. */
export function statusPollGate(args: {
  status: SeriesStatus;
  lastCheckedAt: Date | null;
  now: Date;
}): { skip: boolean; reason: 'ok' | 'status-skip' | 'status-cadence' } {
  const cadence = STATUS_CADENCE_MINUTES[args.status];
  if (cadence === null) return { skip: true, reason: 'status-skip' };
  if (cadence === 0) return { skip: false, reason: 'ok' };
  if (args.lastCheckedAt && args.now.getTime() - args.lastCheckedAt.getTime() < cadence * 60_000) {
    return { skip: true, reason: 'status-cadence' };
  }
  return { skip: false, reason: 'ok' };
}

/** The subset of a Source row the poller needs. */
export interface PollableSource {
  id: string;
  seriesId: string;
  /** The reader's shelf status (WP-27a) — gates whether/how often this source polls. */
  seriesStatus: SeriesStatus;
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
  /** The reader's shelf status at poll time (WP-27a) — notify pushes only for READING. */
  seriesStatus: SeriesStatus;
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

/** Worst-case cost estimate for fetching one group, used by the time-budget guard. A RENDER
 *  group only actually renders when a renderer is configured; without one it falls back to a
 *  plain fetch, so it costs the plain estimate. Pure. WP-41. */
export function groupCostMs(group: PollGroup, hasRenderer: boolean): number {
  return group.fetchMode === 'RENDER' && hasRenderer ? RENDER_COST_MS : PLAIN_COST_MS;
}

/** Order groups least-recently-polled first, so each run drains the stalest hosts and no source
 *  is perpetually starved when the budget can't cover everything. A host with no recorded poll
 *  (null/absent) is treated as infinitely stale and sorts first. Whatever a run drops keeps its
 *  older `lastCheckedAt` (it isn't stamped), so it sorts ahead next run — fair rotation. Pure,
 *  stable (ties keep input order). WP-41. */
export function orderGroupsByStaleness(
  groups: PollGroup[],
  hostLast: Map<string, Date | null>,
): PollGroup[] {
  const staleness = (g: PollGroup): number => hostLast.get(g.host)?.getTime() ?? -Infinity;
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => staleness(a.g) - staleness(b.g) || a.i - b.i)
    .map(({ g }) => g);
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
export const RENDER_ESCALATION_MAX = 5;

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
      const stored = await ports.loadStoredChapters(src.seriesId);
      // FEED: parse the feed and isolate this series. PAGE_WATCH: parse the TOC
      // (already series-scoped) — its chapters carry FREE/LOCKED access.
      let mine: FeedItem[];
      if (src.type === 'PAGE_WATCH') {
        mine = parseToc(res.body, src.fetchUrl);
        // Escalate only when a plain read comes back SMALLER than what we already stored — a
        // real "the TOC stopped rendering" signal. A genuinely small series (read == stored)
        // never regresses, so it is never pinned to expensive renders. (WP-46)
        // NOTE: this flip is deferred and one-way — once a source escalates to RENDER it stays
        // RENDER, so a single transient truncated read can pin it; accepted tradeoff, still
        // strictly less aggressive than the old unconditional ≤5 trigger.
        if (
          ports.renderFetch &&
          src.fetchMode === 'PLAIN' &&
          mine.length <= RENDER_ESCALATION_MAX &&
          mine.length < stored.length
        ) {
          escalateToRender = true;
        }
      } else {
        const parsed = await parseFeed(res.body);
        mine = filterBySeriesMatch(parsed.items, src.match);
      }
      const diff = diffChapters(stored, mine);
      newChapters = diff.new;
      becameFree = diff.becameFree;
      accessReconciled = diff.accessReconciled;
    }
  }

  return {
    sourceId: src.id,
    seriesId: src.seriesId,
    seriesStatus: src.seriesStatus,
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
  opts: { budgetMs?: number; clock?: () => number } = {},
): Promise<PollEffects[]> {
  const budgetMs = opts.budgetMs ?? POLL_BUDGET_MS;
  const clock = opts.clock ?? Date.now;
  const start = clock();
  const hasRenderer = ports.renderFetch != null;

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

  // Drain least-recently-polled hosts first (WP-41): under a tight budget the run polls the
  // stalest and drops its freshest tail — but whatever it drops keeps its older lastCheckedAt,
  // so it sorts ahead next run and the backlog rotates instead of a fixed tail never polling.
  const groups = orderGroupsByStaleness(groupPollSources(sources), hostLast);

  const effects: PollEffects[] = [];
  for (const group of groups) {
    // Status/cadence gate (WP-27a): the win is skipping the (often expensive — RENDER/TOC) FETCH,
    // so gate on whether ANY source in the group is due. Once fetched, every source it covers is
    // processed below — the body's already in hand, so processing a not-due PLANNED sibling is free
    // backlog freshness (notifies are suppressed for non-READING anyway). The weekly cadence still
    // fully applies to a source that would need its OWN fetch (a solo / all-not-due group).
    const anyDue = group.sources.some(
      (s) => !statusPollGate({ status: s.seriesStatus, lastCheckedAt: s.lastCheckedAt, now }).skip,
    );
    if (!anyDue) continue;

    const gate = hostGate({
      hostLastCheckedAt: hostLast.get(group.host) ?? null,
      hostBackoffUntil: hostBackoff.get(group.host) ?? null,
      now,
      minIntervalMs,
    });
    if (gate.skip) continue; // silent no-op; lastCheckedAt untouched

    // Time-budget guard (WP-41).
    if (clock() - start + groupCostMs(group, hasRenderer) > budgetMs) continue;

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
