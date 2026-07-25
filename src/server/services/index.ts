import { db } from '../db';
import { getCurrentUserId } from '../user';
import { politeFetch, type PoliteResult } from '../../lib/feeds/fetch';
import type { SeriesMatch } from '../../lib/feeds/discover';
import type { FailureType } from '../../lib/health';
import { pollAllSources as pollAllCore, type PollableSource, type PollEffects, type PollPorts } from './poll';
import { addSeries as addSeriesCore, type AddSeriesInput, type AddSeriesResult } from './addSeries';
import {
  evaluateSchedules as evaluateSchedulesCore,
  type ScheduledSeries,
  type ScheduleEffect,
  type SchedulePorts,
} from './scheduleNotify';
import type { ReleaseSchedule } from '../../lib/schedule';

export { listSeries, getSeries, updateSeries } from './series';
export { savePushSubscription } from './push';

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

function toSeriesMatch(type: string, value: string | null): SeriesMatch {
  if (type === 'CATEGORY') return { type: 'CATEGORY', value: value ?? '' };
  if (type === 'PATH_PREFIX') return { type: 'PATH_PREFIX', value: value ?? '' };
  return { type: 'WHOLE_FEED' };
}

function rowToPollable(row: {
  id: string;
  seriesId: string;
  type: PollableSource['type'];
  url: string;
  feedUrl: string | null;
  matchType: string;
  matchValue: string | null;
  etag: string | null;
  lastModified: string | null;
  health: PollableSource['health'];
  consecutiveFailures: number;
  failureScore: number;
  lastFailureType: FailureType | 'NONE';
}): PollableSource {
  return {
    id: row.id,
    seriesId: row.seriesId,
    type: row.type,
    fetchUrl: row.feedUrl ?? row.url,
    match: toSeriesMatch(row.matchType, row.matchValue),
    etag: row.etag,
    lastModified: row.lastModified,
    health: row.health,
    consecutiveFailures: row.consecutiveFailures,
    failureScore: row.failureScore,
    lastFailureType: row.lastFailureType === 'NONE' ? null : row.lastFailureType,
  };
}

function pollPorts(fetchImpl: FetchImpl): PollPorts & { loadActiveSources: () => Promise<PollableSource[]> } {
  return {
    fetch: fetchImpl,
    loadActiveSources: async () => (await db.source.findMany({ where: { isActive: true } })).map(rowToPollable),
    loadStoredChapters: async (seriesId) =>
      (await db.chapter.findMany({ where: { seriesId }, select: { guid: true, url: true } })).map((c) => ({
        guid: c.guid ?? undefined,
        url: c.url,
      })),
    applyPollEffects: async (e: PollEffects) => {
      const now = new Date();
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
      ]);
    },
  };
}

/** Poll every active source, diffing new chapters and updating health. */
export function pollAllSources(fetchImpl: FetchImpl = fetchPort): Promise<PollEffects[]> {
  return pollAllCore(pollPorts(fetchImpl));
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
                  })),
                }
              : undefined,
        },
      });
      return { seriesId: series.id };
    },
  });
}
