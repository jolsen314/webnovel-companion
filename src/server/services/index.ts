import { db } from '../db';
import { getCurrentUserId } from '../user';
import { politeFetch, type PoliteResult } from '../../lib/feeds/fetch';
import { makeRenderFetch } from '../../lib/feeds/renderFetch';
import type { SeriesMatch } from '../../lib/feeds/discover';
import type { FailureType } from '../../lib/health';
import { diffChapters, canonicalUrl } from '../../lib/feeds/diff';
import { parseToc, tocReadingOrder } from '../../lib/feeds/pageWatch';
import {
  pollAllSources as pollAllCore,
  sourceTierWhere,
  type PollableSource,
  type PollEffects,
  type PollPorts,
  type PollTier,
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
export { savePushSubscription } from './push';
export { getNotificationPrefs, updateNotificationPrefs, type NotificationPrefsView } from './notificationPrefs';
export { pruneChapters, deleteSeries, resetChapters, setSourceUrl, mergeSeries, listSeriesForCleanup } from './cleanup';

/**
 * Prisma/HTTP bindings for the poll + add-series orchestration. The logic lives in
 * ./poll and ./addSeries (unit-tested with fakes); this file is the thin edge that
 * supplies real ports. It is exercised by integration tests against a test Postgres
 * (WP-11), not by unit tests.
 */

/** The HTTP port. Defaults to real `politeFetch`; integration tests inject a fake. */
export type FetchImpl = (
  url: string,
  opts?: { etag?: string | null; lastModified?: string | null },
) => Promise<PoliteResult>;

const fetchPort: FetchImpl = (url, opts) =>
  politeFetch(url, { etag: opts?.etag ?? undefined, lastModified: opts?.lastModified ?? undefined });

/** The headless-render fetch port, or undefined when no renderer is configured (WP-17b). */
function renderPort(): FetchImpl | undefined {
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
}): PollableSource {
  return {
    id: row.id,
    seriesId: row.seriesId,
    type: row.type,
    fetchMode: row.fetchMode,
    fetchUrl: row.feedUrl ?? row.url,
    match: toSeriesMatch(row.matchType, row.matchValue),
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

function pollPorts(
  fetchImpl: FetchImpl,
  renderImpl?: FetchImpl,
  now: Date = new Date(),
  tier: PollTier = 'all',
): PollPorts & { loadActiveSources: () => Promise<PollableSource[]> } {
  return {
    fetch: fetchImpl,
    renderFetch: renderImpl,
    loadActiveSources: async () => (await db.source.findMany({ where: sourceTierWhere(tier) })).map(rowToPollable),
    loadStoredChapters: async (seriesId) =>
      (await db.chapter.findMany({ where: { seriesId }, select: { id: true, guid: true, url: true, access: true } })).map((c) => ({
        id: c.id,
        guid: c.guid ?? undefined,
        url: c.url,
        access: c.access === 'UNKNOWN' ? undefined : c.access,
      })),
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
        ...e.becameFree.flatMap((c) =>
          c.id
            ? [
                db.chapter.updateMany({
                  where: { id: c.id, becameFreeAt: null },
                  data: { access: 'FREE' as const, becameFreeAt: now },
                }),
              ]
            : [],
        ),
        ...e.accessReconciled.flatMap((c) =>
          c.id
            ? [db.chapter.updateMany({ where: { id: c.id }, data: { access: c.access ?? 'UNKNOWN' } })]
            : [],
        ),
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
    .map((e) => ({ seriesId: e.seriesId, count: e.newChapters.filter((c) => c.access !== 'LOCKED').length }))
    .filter((n) => n.count > 0);
  const nowFree = pollEffects
    .filter((e) => e.becameFree.length > 0)
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
export function addSeries(input: AddSeriesInput, fetchImpl: FetchImpl = fetchPort): Promise<AddSeriesResult> {
  return addSeriesCore(input, {
    fetch: fetchImpl,
    createSeries: async (r) => {
      const series = await db.series.create({
        data: {
          userId: getCurrentUserId(),
          title: r.seriesTitle,
          sources: {
            create: {
              url: r.sourceUrl,
              host: r.host,
              type: r.type,
              feedUrl: r.feedUrl,
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

/** One-time TOC read for a feed (or any) series: add the older tail the feed window never showed and
 *  reconcile feed-originated UNKNOWN chapters to the TOC's FREE/LOCKED. Silent — never pushes, never
 *  touches source health/etag (it reads the reading page, not the feed). */
export async function backfillFromToc(
  seriesId: string,
  fetchImpl: FetchImpl = fetchPort,
): Promise<{ added: number; reconciled: number }> {
  const owned = await db.series.findFirst({ where: { id: seriesId, userId: getCurrentUserId() }, select: { id: true } });
  if (!owned) return { added: 0, reconciled: 0 };
  const source = await db.source.findFirst({ where: { seriesId, isActive: true } });
  if (!source) return { added: 0, reconciled: 0 };
  const res = await fetchImpl(source.url, {});
  if (res.outcome !== 'SUCCESS' || res.notModified) return { added: 0, reconciled: 0 };

  const toc = parseToc(res.body, source.url);
  const order = tocReadingOrder(toc);
  const storedRows = await db.chapter.findMany({
    where: { seriesId },
    select: { id: true, guid: true, url: true, access: true, position: true },
  });
  const stored = storedRows.map((c) => ({
    id: c.id,
    guid: c.guid ?? undefined,
    url: c.url,
    access: c.access === 'UNKNOWN' ? undefined : c.access,
  }));
  const diff = diffChapters(stored, toc);
  // Re-index positions only when this TOC read is authoritative for the whole reading order.
  // Safe when every already-stored chapter is either listed in the TOC OR still unpositioned:
  //   - listed → gets its normalized index;
  //   - absent but unpositioned → a feed-ahead chapter (published to the feed before the
  //     hand-maintained TOC lists it); left null, it sorts last (= newest), colliding with nothing.
  // Blocked only when an absent chapter already HAS a position — a windowed/trimmed TOC (site
  // dropped an old chapter), where re-indexing the present chapters into a fresh 0..N-1 block
  // would collide with the dropped chapter's retained position. Then we leave positions as-is.
  const tocReindexable =
    order != null && storedRows.every((s) => order.has(canonicalUrl(s.url)) || s.position == null);

  const now = new Date();
  await db.$transaction([
    ...(diff.new.length > 0
      ? [
          db.chapter.createMany({
            data: diff.new.map((c) => ({
              seriesId,
              sourceId: source.id,
              title: c.title,
              url: c.url,
              guid: c.guid ?? null,
              number: c.number ?? null,
              access: c.access ?? 'UNKNOWN',
              position: tocReindexable ? (order!.get(canonicalUrl(c.url)) ?? null) : null,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...diff.becameFree.flatMap((c) =>
      c.id ? [db.chapter.updateMany({ where: { id: c.id, becameFreeAt: null }, data: { access: 'FREE' as const, becameFreeAt: now } })] : [],
    ),
    ...diff.accessReconciled.flatMap((c) =>
      c.id ? [db.chapter.updateMany({ where: { id: c.id }, data: { access: c.access ?? 'UNKNOWN' } })] : [],
    ),
    ...(tocReindexable
      ? stored.flatMap((s) => {
          const pos = order!.get(canonicalUrl(s.url));
          return pos != null ? [db.chapter.updateMany({ where: { id: s.id }, data: { position: pos } })] : [];
        })
      : []),
  ]);
  return { added: diff.new.length, reconciled: diff.accessReconciled.length };
}
