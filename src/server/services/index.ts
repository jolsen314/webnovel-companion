import type { Prisma } from '@prisma/client';
import { db } from '../db';
import { getCurrentUserId } from '../user';
import { politeFetch, type PoliteResult } from '../../lib/feeds/fetch';
import { makeRenderFetch } from '../../lib/feeds/renderFetch';
import type { SeriesMatch } from '../../lib/feeds/discover';
import type { ApiDescriptor, PaginationSpec } from '../../lib/feeds/apiAdapter';
import type { FailureType } from '../../lib/health';
import { type KnownChapter } from '../../lib/feeds/diff';
import { runBackfill, type BackfillPorts, type BackfillPlan, type StoredChapter } from './backfill';
import {
  pollAllSources as pollAllCore,
  sourceTierWhere,
  POLLABLE_STATUSES,
  type PollableSource,
  type PollEffects,
  type PollPorts,
  type PollTier,
  type SeriesStatus,
} from './poll';
import { addSeries as addSeriesCore, type AddSeriesInput, type AddSeriesResult } from './addSeries';
import {
  evaluateSchedules as evaluateSchedulesCore,
  type ScheduledSeries,
  type ScheduleEffect,
  type SchedulePorts,
} from './scheduleNotify';
import type { ReleaseSchedule } from '../../lib/schedule';
// Default import (not named): web-push is CJS-only and node's ESM loader only
// partially detects its dynamically-assigned named exports via cjs-module-lexer,
// which breaks `tsx`-run scripts (e.g. scripts/cleanup-series.ts) even though
// bundlers (webpack/Vite) paper over it. `webPush.<fn>` always resolves.
import webPush from 'web-push';
import { buildPushMessages } from '../../lib/notify';
import { classifyPushFailure, sendPushMessages, type PushSendPorts, type SendSummary } from './pushSend';
import { getNotificationPrefs } from './notificationPrefs';

export { listSeries, getSeries, updateSeries } from './series';
export { getFeed } from './feed';
export { savePushSubscription } from './push';
export { getNotificationPrefs, updateNotificationPrefs, type NotificationPrefsView } from './notificationPrefs';
export {
  pruneChapters,
  deleteSeries,
  resetChapters,
  setSourceUrl,
  mergeSeries,
  listSeriesForCleanup,
  reclassifySource,
  setApiDescriptor,
} from './cleanup';
import { reclassifySource } from './cleanup';

/**
 * Prisma/HTTP bindings for the poll + add-series orchestration. The logic lives in
 * ./poll and ./addSeries (unit-tested with fakes); this file is the thin edge that
 * supplies real ports. It is exercised by integration tests against a test Postgres
 * (WP-11), not by unit tests.
 */

/** The HTTP port. Defaults to real `politeFetch`; integration tests inject a fake. */
export type FetchImpl = (
  url: string,
  opts?: { etag?: string | null; lastModified?: string | null; pagination?: PaginationSpec },
) => Promise<PoliteResult>;

const fetchPort: FetchImpl = (url, opts) =>
  politeFetch(url, { etag: opts?.etag ?? undefined, lastModified: opts?.lastModified ?? undefined });

/** The headless-render fetch port, or undefined when no renderer is configured (WP-17b). */
export function renderPort(): FetchImpl | undefined {
  const endpoint = process.env.RENDER_URL;
  if (!endpoint) return undefined;
  return makeRenderFetch({ endpoint, secret: process.env.RENDER_SECRET });
}

function toSeriesMatch(type: string, value: string | null): SeriesMatch {
  if (type === 'CATEGORY') return { type: 'CATEGORY', value: value ?? '' };
  if (type === 'PATH_PREFIX') return { type: 'PATH_PREFIX', value: value ?? '' };
  return { type: 'WHOLE_FEED' };
}

function rowToPollable(row: {
  id: string;
  seriesId: string;
  type: PollableSource['type'];
  fetchMode: PollableSource['fetchMode'];
  url: string;
  host: string;
  feedUrl: string | null;
  tocUrl: string | null;
  apiUrl: string | null;
  apiMap: unknown; // Prisma Json — cast to ApiDescriptor below
  matchType: string;
  matchValue: string | null;
  etag: string | null;
  lastModified: string | null;
  health: PollableSource['health'];
  consecutiveFailures: number;
  failureScore: number;
  lastFailureType: FailureType | 'NONE';
  lastCheckedAt: Date | null;
  backoffUntil: Date | null;
  series: { status: SeriesStatus };
}): PollableSource {
  return {
    id: row.id,
    seriesId: row.seriesId,
    seriesStatus: row.series.status,
    type: row.type,
    fetchMode: row.fetchMode,
    fetchUrl: row.apiUrl ?? row.feedUrl ?? row.tocUrl ?? row.url, // WP-45: API endpoint wins; then WP-37 TOC
    match: toSeriesMatch(row.matchType, row.matchValue),
    apiMap: (row.apiMap as ApiDescriptor | null) ?? null, // WP-45
    etag: row.etag,
    lastModified: row.lastModified,
    health: row.health,
    consecutiveFailures: row.consecutiveFailures,
    failureScore: row.failureScore,
    lastFailureType: row.lastFailureType === 'NONE' ? null : row.lastFailureType,
    host: row.host,
    lastCheckedAt: row.lastCheckedAt,
    backoffUntil: row.backoffUntil,
  };
}

/** Project a stored chapter row onto the pure `KnownChapter` the diff engine consumes
 *  (UNKNOWN access → undefined). Shared by the poll and backfill loaders. */
function toKnownChapter(c: { id: string; guid: string | null; url: string; access: 'FREE' | 'LOCKED' | 'UNKNOWN' }): KnownChapter {
  return { id: c.id, guid: c.guid ?? undefined, url: c.url, access: c.access === 'UNKNOWN' ? undefined : c.access };
}

/** `$transaction` ops flipping each unlocked chapter to FREE (once — guarded on `becameFreeAt: null`).
 *  Shared by `applyPollEffects` and `backfillFromToc`, which must stay in lockstep. */
function becameFreeOps(chapters: KnownChapter[], now: Date) {
  return chapters.flatMap((c) =>
    c.id
      ? [db.chapter.updateMany({ where: { id: c.id, becameFreeAt: null }, data: { access: 'FREE' as const, becameFreeAt: now } })]
      : [],
  );
}

/** `$transaction` ops writing each chapter's reconciled access (UNKNOWN → learned FREE/LOCKED). Shared. */
function accessReconciledOps(chapters: KnownChapter[]) {
  return chapters.flatMap((c) =>
    c.id ? [db.chapter.updateMany({ where: { id: c.id }, data: { access: c.access ?? 'UNKNOWN' } })] : [],
  );
}

function pollPorts(
  fetchImpl: FetchImpl,
  renderImpl?: FetchImpl,
  now: Date = new Date(),
  tier: PollTier = 'all',
): PollPorts & { loadActiveSources: () => Promise<PollableSource[]> } {
  return {
    fetch: fetchImpl,
    renderFetch: renderImpl,
    loadActiveSources: async () =>
      (
        await db.source.findMany({
          where: { ...sourceTierWhere(tier), linkOnly: false, series: { status: { in: POLLABLE_STATUSES } } },
          include: { series: { select: { status: true } } },
        })
      ).map(rowToPollable),
    loadStoredChapters: async (seriesId) =>
      (await db.chapter.findMany({ where: { seriesId }, select: { id: true, guid: true, url: true, access: true } })).map(toKnownChapter),
    applyPollEffects: async (e: PollEffects) => {
      await db.$transaction([
        db.source.update({
          where: { id: e.sourceId },
          data: {
            health: e.health.health,
            consecutiveFailures: e.health.consecutiveFailures,
            failureScore: e.health.score,
            lastFailureType: e.health.lastFailureType ?? 'NONE',
            etag: e.etag,
            lastModified: e.lastModified,
            lastCheckedAt: now,
            ...(e.succeeded ? { lastSuccessAt: now } : {}),
            ...(e.escalateToRender ? { fetchMode: 'RENDER' as const } : {}),
            ...(e.backoffUntil !== undefined ? { backoffUntil: e.backoffUntil } : {}),
          },
        }),
        ...(e.newChapters.length > 0
          ? [
              db.chapter.createMany({
                data: e.newChapters.map((c) => ({
                  seriesId: e.seriesId,
                  sourceId: e.sourceId,
                  title: c.title,
                  url: c.url,
                  guid: c.guid ?? null,
                  number: c.number ?? null,
                  publishedAt: c.publishedAt ?? null,
                  access: c.access ?? 'UNKNOWN',
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
        ...becameFreeOps(e.becameFree, now),
        ...accessReconciledOps(e.accessReconciled),
      ]);
    },
  };
}

/** Poll every active source, diffing new chapters and updating health. Fetches once per
 *  distinct feed/page (fanning out to every series it covers) and gates per host — a host in
 *  backoff or polled within the last `MIN_POLL_INTERVAL_MINUTES` is skipped this cycle. */
export function pollAllSources(
  fetchImpl: FetchImpl = fetchPort,
  renderImpl: FetchImpl | undefined = renderPort(),
  now: Date = new Date(),
  tier: PollTier = 'all',
): Promise<PollEffects[]> {
  return pollAllCore(pollPorts(fetchImpl, renderImpl, now, tier), now);
}

/** Build a pure `ReleaseSchedule` from a Series row's schedule columns (null if malformed). */
function toReleaseSchedule(row: {
  releaseScheduleKind: 'INTERVAL' | 'WEEKLY' | null;
  releaseCadenceDays: number | null;
  releaseAnchoredOn: Date | null;
  releaseWeekdays: number[];
}): ReleaseSchedule | null {
  if (row.releaseScheduleKind === 'INTERVAL') {
    if (row.releaseCadenceDays === null || row.releaseAnchoredOn === null) return null;
    return { kind: 'INTERVAL', cadenceDays: row.releaseCadenceDays, anchoredOn: row.releaseAnchoredOn };
  }
  if (row.releaseScheduleKind === 'WEEKLY') return { kind: 'WEEKLY', weekdays: row.releaseWeekdays };
  return null;
}

function schedulePorts(): SchedulePorts {
  return {
    loadScheduledSeries: async () => {
      const rows = await db.series.findMany({
        where: { releaseScheduleKind: { not: null } },
        select: {
          id: true,
          releaseScheduleKind: true,
          releaseCadenceDays: true,
          releaseAnchoredOn: true,
          releaseWeekdays: true,
          releaseEventKind: true,
          scheduleLastNotifiedAt: true,
        },
      });
      return rows.flatMap((row): ScheduledSeries[] => {
        const schedule = toReleaseSchedule(row);
        if (!schedule) return [];
        return [{ seriesId: row.id, schedule, lastNotifiedAt: row.scheduleLastNotifiedAt, eventKind: row.releaseEventKind }];
      });
    },
    applyScheduleEffects: async (effects) => {
      await db.$transaction(
        effects.map((e) => db.series.update({ where: { id: e.seriesId }, data: { scheduleLastNotifiedAt: e.releaseDate } })),
      );
    },
  };
}

/** Evaluate every series' manual release schedule; stamp + return the ones now due (WP-29). */
export function evaluateSchedules(now: Date = new Date()): Promise<ScheduleEffect[]> {
  return evaluateSchedulesCore(schedulePorts(), now);
}

// ── Web Push (WP-09) ─────────────────────────────────────────────────────────

let vapidReady: boolean | null = null;
/** Configure web-push from env once. Missing keys → sending is skipped (local dev). */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    webPush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', publicKey, privateKey);
    vapidReady = true;
  } else {
    vapidReady = false;
  }
  return vapidReady;
}

function pushSendPorts(): PushSendPorts {
  return {
    loadSubscriptions: () =>
      db.pushSubscription.findMany({ select: { endpoint: true, p256dh: true, auth: true } }),
    send: async (target, message) => {
      if (!ensureVapid()) return 'FAILED'; // no keys configured → don't crash the cron
      try {
        await webPush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
        );
        return 'SENT';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        const outcome = classifyPushFailure(status);
        // Log the status so a persistent failure is diagnosable — the send summary only counts
        // it. Host only: the endpoint path carries a per-subscription secret token.
        let host = 'unknown';
        try {
          host = new URL(target.endpoint).host;
        } catch {
          /* keep 'unknown' */
        }
        console.warn(`push send ${outcome}`, { status: status ?? 'none', host });
        return outcome;
      }
    },
    deleteSubscription: async (endpoint) => {
      await db.pushSubscription.delete({ where: { endpoint } }).catch(() => {}); // already gone is fine
    },
  };
}

/** Preload titles for the given series ids → a resolver for `buildPushMessages`. */
async function seriesTitleResolver(ids: string[]): Promise<(id: string) => string> {
  const unique = [...new Set(ids)];
  const rows =
    unique.length > 0
      ? await db.series.findMany({ where: { id: { in: unique } }, select: { id: true, title: true } })
      : [];
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  return (id) => titles.get(id) ?? 'A series';
}

/** Turn a cron run's poll + schedule effects into push notifications and send them. */
export async function notifyForEffects(
  pollEffects: PollEffects[],
  scheduleEffects: ScheduleEffect[],
  ports: PushSendPorts = pushSendPorts(),
): Promise<SendSummary> {
  const newChapters = pollEffects
    .filter((e) => e.seriesStatus === 'READING')
    .map((e) => ({ seriesId: e.seriesId, count: e.newChapters.filter((c) => c.access !== 'LOCKED').length }))
    .filter((n) => n.count > 0);
  const nowFree = pollEffects
    .filter((e) => e.seriesStatus === 'READING' && e.becameFree.length > 0)
    .map((e) => ({ seriesId: e.seriesId, count: e.becameFree.length }));
  const scheduledReleases = scheduleEffects.map((e) => ({ seriesId: e.seriesId, eventKind: e.eventKind }));

  // Source-down alerts need the host, which lives on the Source row.
  const downSourceIds = pollEffects.filter((e) => e.crossedDown).map((e) => e.sourceId);
  const downSources =
    downSourceIds.length > 0
      ? await db.source.findMany({ where: { id: { in: downSourceIds } }, select: { seriesId: true, host: true } })
      : [];
  const sourcesDown = downSources.map((s) => ({ seriesId: s.seriesId, host: s.host }));

  const seriesTitle = await seriesTitleResolver([
    ...newChapters.map((n) => n.seriesId),
    ...nowFree.map((n) => n.seriesId),
    ...scheduledReleases.map((s) => s.seriesId),
    ...sourcesDown.map((s) => s.seriesId),
  ]);

  const prefs = await getNotificationPrefs();
  const messages = buildPushMessages({
    seriesTitle,
    newChapters,
    nowFree,
    scheduledReleases,
    sourcesDown,
    push: {
      newChapters: prefs.pushNewChapter,
      scheduledReleases: prefs.pushScheduled,
      sourcesDown: prefs.pushSourceDown,
    },
  });
  return sendPushMessages(messages, ports);
}

/** Fire one canned push to every subscription — validates the full VAPID/send path. */
export function sendTestNotification(ports: PushSendPorts = pushSendPorts()): Promise<SendSummary> {
  return sendPushMessages(
    [{ title: 'Test notification', body: 'Push is working — real chapter alerts will look like this.', url: '/settings', tag: 'test' }],
    ports,
  );
}

/** Resolve a pasted URL to a feed (or page-watch) and create the Series + Source. */
export function addSeries(
  input: AddSeriesInput,
  fetchImpl: FetchImpl = fetchPort,
  renderImpl: FetchImpl | undefined = renderPort(),
): Promise<AddSeriesResult> {
  return addSeriesCore(input, {
    fetch: fetchImpl,
    render: renderImpl,
    findSeriesByCanonicalId: async (canonicalId) => {
      const s = await db.series.findFirst({ where: { userId: getCurrentUserId(), canonicalId }, select: { id: true } });
      return s ? { seriesId: s.id } : null;
    },
    listExistingSeries: async () =>
      db.series.findMany({ where: { userId: getCurrentUserId() }, select: { id: true, title: true } }),
    createSeries: async (r) => {
      const series = await db.series.create({
        data: {
          userId: getCurrentUserId(),
          title: r.seriesTitle,
          canonicalId: r.canonicalId, // WP-39
          sources: {
            create: {
              url: r.sourceUrl,
              host: r.host,
              type: r.type,
              linkOnly: r.linkOnly,
              fetchMode: r.fetchMode, // WP-46
              feedUrl: r.feedUrl,
              tocUrl: r.tocUrl, // WP-37
              apiUrl: r.apiUrl, // WP-45
              ...(r.apiMap ? { apiMap: r.apiMap as unknown as Prisma.InputJsonValue } : {}), // WP-45: Prisma Json — omit when null
              matchType: r.match.type,
              matchValue: 'value' in r.match ? r.match.value : null,
            },
          },
          chapters:
            r.chapters.length > 0
              ? {
                  create: r.chapters.map((c) => ({
                    title: c.title,
                    url: c.url,
                    guid: c.guid ?? null,
                    number: c.number ?? null,
                    publishedAt: c.publishedAt ?? null,
                    access: c.access ?? 'UNKNOWN',
                    position: c.position ?? null,
                  })),
                }
              : undefined,
        },
      });
      return { seriesId: series.id };
    },
  });
}

/** Project a stored chapter row onto the pure `StoredChapter` the backfill planner consumes:
 *  `toKnownChapter`'s diff identity plus the `position` its reindex-collision predicate reads. */
function toStoredChapter(c: {
  id: string;
  guid: string | null;
  url: string;
  access: 'FREE' | 'LOCKED' | 'UNKNOWN';
  position: number | null;
}): StoredChapter {
  return { ...toKnownChapter(c), id: c.id, position: c.position };
}

/** Turn a pure `BackfillPlan` into the write transaction — createMany-with-position, the shared
 *  becameFree/accessReconciled ops, the reindex updates, and the optional tocUrl/title persists. */
async function applyBackfillPlan(seriesId: string, sourceId: string, plan: BackfillPlan): Promise<void> {
  const now = new Date();
  await db.$transaction([
    ...(plan.newChapters.length > 0
      ? [
          db.chapter.createMany({
            data: plan.newChapters.map((c) => ({
              seriesId,
              sourceId,
              title: c.title,
              url: c.url,
              guid: c.guid,
              number: c.number,
              access: c.access,
              position: c.position,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...becameFreeOps(plan.becameFree, now),
    ...accessReconciledOps(plan.accessReconciled),
    ...plan.reindex.map((r) => db.chapter.updateMany({ where: { id: r.id }, data: { position: r.position } })),
    ...(plan.persistTocUrl != null
      ? [db.source.update({ where: { id: sourceId }, data: { tocUrl: plan.persistTocUrl } })]
      : []),
    ...(plan.persistTitle != null
      ? [db.series.update({ where: { id: seriesId }, data: { title: plan.persistTitle } })]
      : []),
  ]);
}

/** Prisma bindings for a backfill run: ownership + active source folded into one meta load, the
 *  stored-chapter load, and the plan-writer — the decision logic lives in `runBackfill` + the pure
 *  `services/backfill` core (unit-tested with fakes), exactly like `pollPorts`/`schedulePorts`. */
function backfillPorts(seriesId: string, fetchImpl: FetchImpl): BackfillPorts {
  return {
    fetch: (url) => fetchImpl(url, {}),
    loadSeriesMeta: async () => {
      const owned = await db.series.findFirst({
        where: { id: seriesId, userId: getCurrentUserId() },
        select: { title: true, titleIsManual: true },
      });
      if (!owned) return null;
      const source = await db.source.findFirst({ where: { seriesId, isActive: true } });
      if (!source) return null;
      return {
        currentTitle: owned.title,
        titleIsManual: owned.titleIsManual,
        sourceId: source.id,
        sourceUrl: source.url,
        host: source.host,
        tocUrl: source.tocUrl,
      };
    },
    loadStoredChapters: async () =>
      (
        await db.chapter.findMany({
          where: { seriesId },
          select: { id: true, guid: true, url: true, access: true, position: true },
        })
      ).map(toStoredChapter),
    applyBackfillPlan: (sourceId, plan) => applyBackfillPlan(seriesId, sourceId, plan),
  };
}

/** One-time TOC read for a feed (or any) series: add the older tail the feed window never showed and
 *  reconcile feed-originated UNKNOWN chapters to the TOC's FREE/LOCKED. Silent — never pushes, never
 *  touches source health/etag (it reads the reading page, not the feed). Thin edge over `runBackfill`. */
export function backfillFromToc(
  seriesId: string,
  fetchImpl: FetchImpl = fetchPort,
): Promise<{ added: number; reconciled: number; titleUpdated?: string }> {
  return runBackfill(backfillPorts(seriesId, fetchImpl));
}

/** Shared plain→render escalation for a TOC backfill: read plain first; if that produced
 *  nothing (CF-blocked / empty) and a renderer is available, retry via render. When render
 *  recovers chapters and the series' active source is PAGE_WATCH, persist fetchMode RENDER —
 *  a FEED source polls its feed plainly, so the render here was a one-time TOC read, not a
 *  standing fetch-mode change. Silent — backfill fires no pushes. Used by both the in-app
 *  "Backfill from TOC" button and `switchToPageWatch`'s post-flip seed. */
export async function backfillWithEscalation(
  seriesId: string,
  ports: { fetchImpl?: FetchImpl; renderImpl?: FetchImpl } = {},
): Promise<{ added: number; reconciled: number; rendered: boolean; titleUpdated?: string }> {
  const fetchImpl = ports.fetchImpl ?? fetchPort;
  const renderImpl = 'renderImpl' in ports ? ports.renderImpl : renderPort();
  const plain = await backfillFromToc(seriesId, fetchImpl);
  if (!(renderImpl && plain.added === 0 && plain.reconciled === 0)) {
    return { added: plain.added, reconciled: plain.reconciled, rendered: false, titleUpdated: plain.titleUpdated };
  }
  const r = await backfillFromToc(seriesId, renderImpl);
  if (r.added === 0 && r.reconciled === 0) {
    return { added: 0, reconciled: 0, rendered: false, titleUpdated: r.titleUpdated ?? plain.titleUpdated };
  }
  // Render recovered chapters. Persist RENDER only for a PAGE_WATCH source — a FEED source polls its
  // feed plainly; the render here was a one-time TOC read.
  const userId = getCurrentUserId();
  const src = await db.source.findFirst({ where: { seriesId, isActive: true, series: { userId } }, select: { id: true, type: true } });
  if (src?.type === 'PAGE_WATCH') {
    await db.source.update({ where: { id: src.id }, data: { fetchMode: 'RENDER' } });
  }
  return { added: r.added, reconciled: r.reconciled, rendered: true, titleUpdated: r.titleUpdated };
}

/** WP-34 "Track unlocks": flip the active FEED source to PAGE_WATCH and silently seed the TOC.
 *  Reads plain first; if that produced nothing (CF-blocked / empty) and a renderer is available,
 *  retries via render and persists fetchMode RENDER. Silent — backfill fires no pushes. */
export async function switchToPageWatch(
  seriesId: string,
  ports: { fetchImpl?: FetchImpl; renderImpl?: FetchImpl } = {},
): Promise<{ ok: boolean; added: number; reconciled: number; fetchMode: 'PLAIN' | 'RENDER'; rendered: boolean }> {
  const userId = getCurrentUserId();
  const source = await db.source.findFirst({
    where: { seriesId, isActive: true, series: { userId } },
    select: { id: true, type: true },
  });
  if (!source || source.type !== 'FEED') {
    return { ok: false, added: 0, reconciled: 0, fetchMode: 'PLAIN', rendered: false };
  }

  await reclassifySource(source.id); // → PAGE_WATCH / PLAIN
  const b = await backfillWithEscalation(seriesId, ports);
  // Report the source's actual persisted fetchMode (the ratchet never downgrades, so a
  // pre-RENDER source that didn't escalate this switch still reports RENDER).
  const { fetchMode } = await db.source.findUniqueOrThrow({ where: { id: source.id }, select: { fetchMode: true } });
  return { ok: true, added: b.added, reconciled: b.reconciled, fetchMode, rendered: b.rendered };
}
