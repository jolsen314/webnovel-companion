/**
 * Pure request validators for the API routes. Route handlers stay thin: parse the
 * JSON body, run it through one of these, and map `{ ok: false }` to a 400. Keeping
 * validation here (not in the handlers) makes it unit-testable without HTTP.
 */

import type { PollTier } from '../services/poll';
import { SERIES_STATUSES, type SeriesStatus } from '../../lib/series';

export type { SeriesStatus };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const err = (error: string): ParseResult<never> => ({ ok: false, error });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export interface AddSeriesBody {
  url: string;
  title?: string;
  allowLinkOnly?: boolean;
}

export function parseAddSeriesBody(input: unknown): ParseResult<AddSeriesBody> {
  if (!isObject(input)) return err('Expected a JSON object.');
  if (typeof input.url !== 'string') return err('A "url" string is required.');
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return err('That doesn’t look like a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return err('The URL must start with http:// or https://.');
  }
  if (input.title !== undefined && typeof input.title !== 'string') return err('"title" must be a string.');
  const value: AddSeriesBody = { url: input.url };
  if (typeof input.title === 'string') value.title = input.title;
  if (input.allowLinkOnly !== undefined) {
    if (typeof input.allowLinkOnly !== 'boolean') return err('"allowLinkOnly" must be a boolean.');
    value.allowLinkOnly = input.allowLinkOnly;
  }
  return ok(value);
}

/** Valid `ReleaseEventKind` values (mirrors the Prisma enum) for runtime validation. */
export const RELEASE_EVENT_KINDS = ['NEW_CHAPTER', 'UNLOCKED'] as const;
export type ReleaseEventKind = (typeof RELEASE_EVENT_KINDS)[number];

/**
 * A manual release-schedule edit (WP-29), as accepted from the client. `NONE` clears the
 * schedule; INTERVAL/WEEKLY set it. `anchoredOn` arrives as an ISO date string and is parsed
 * to a Date here so the service persists a `DateTime` directly.
 */
export type SeriesScheduleUpdate =
  | { kind: 'NONE' }
  | { kind: 'INTERVAL'; cadenceDays: number; anchoredOn: Date; eventKind: ReleaseEventKind }
  | { kind: 'WEEKLY'; weekdays: number[]; eventKind: ReleaseEventKind };

const MAX_CADENCE_DAYS = 365;

function parseReleaseSchedule(input: unknown): ParseResult<SeriesScheduleUpdate> {
  if (!isObject(input)) return err('"releaseSchedule" must be an object.');

  if (input.kind === 'NONE') return ok({ kind: 'NONE' });

  // eventKind is optional and defaults to NEW_CHAPTER; when present it must be a known value.
  let eventKind: ReleaseEventKind = 'NEW_CHAPTER';
  if (input.eventKind !== undefined) {
    if (!RELEASE_EVENT_KINDS.includes(input.eventKind as ReleaseEventKind)) {
      return err('Invalid schedule "eventKind".');
    }
    eventKind = input.eventKind as ReleaseEventKind;
  }

  if (input.kind === 'INTERVAL') {
    const { cadenceDays, anchoredOn } = input;
    if (typeof cadenceDays !== 'number' || !Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > MAX_CADENCE_DAYS) {
      return err(`"cadenceDays" must be a whole number from 1 to ${MAX_CADENCE_DAYS}.`);
    }
    if (typeof anchoredOn !== 'string') return err('"anchoredOn" (a date) is required.');
    const anchor = new Date(anchoredOn);
    if (Number.isNaN(anchor.getTime())) return err('"anchoredOn" is not a valid date.');
    return ok({ kind: 'INTERVAL', cadenceDays, anchoredOn: anchor, eventKind });
  }

  if (input.kind === 'WEEKLY') {
    const { weekdays } = input;
    if (!Array.isArray(weekdays) || weekdays.length === 0) return err('"weekdays" must be a non-empty array.');
    if (!weekdays.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)) {
      return err('Each weekday must be an integer from 0 (Sun) to 6 (Sat).');
    }
    if (new Set(weekdays).size !== weekdays.length) return err('"weekdays" must not contain duplicates.');
    return ok({ kind: 'WEEKLY', weekdays: weekdays as number[], eventKind });
  }

  return err('"releaseSchedule.kind" must be NONE, INTERVAL, or WEEKLY.');
}

export interface SeriesUpdate {
  status?: SeriesStatus;
  rating?: number;
  notes?: string;
  title?: string;
  lastReadChapterId?: string | null;
  releaseSchedule?: SeriesScheduleUpdate;
}

export function parseSeriesUpdate(input: unknown): ParseResult<SeriesUpdate> {
  if (!isObject(input)) return err('Expected a JSON object.');
  const value: SeriesUpdate = {};

  if (input.status !== undefined) {
    if (!SERIES_STATUSES.includes(input.status as SeriesStatus)) return err('Invalid status.');
    value.status = input.status as SeriesStatus;
  }
  if (input.rating !== undefined) {
    if (typeof input.rating !== 'number' || !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      return err('Rating must be a whole number from 1 to 5.');
    }
    value.rating = input.rating;
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') return err('"notes" must be a string.');
    value.notes = input.notes;
  }
  if (input.title !== undefined) {
    if (typeof input.title !== 'string') return err('"title" must be a string.');
    const title = input.title.trim();
    if (title.length === 0) return err('"title" cannot be empty.');
    if (title.length > 500) return err('"title" is too long.');
    value.title = title;
  }
  if (input.lastReadChapterId !== undefined) {
    if (input.lastReadChapterId !== null && typeof input.lastReadChapterId !== 'string') {
      return err('"lastReadChapterId" must be a string or null.');
    }
    value.lastReadChapterId = input.lastReadChapterId;
  }
  if (input.releaseSchedule !== undefined) {
    const parsed = parseReleaseSchedule(input.releaseSchedule);
    if (!parsed.ok) return parsed;
    value.releaseSchedule = parsed.value;
  }

  if (Object.keys(value).length === 0) return err('No fields to update.');
  return ok(value);
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function parsePushSubscription(input: unknown): ParseResult<PushSubscriptionInput> {
  if (!isObject(input)) return err('Expected a JSON object.');
  const keys = input.keys;
  if (typeof input.endpoint !== 'string') return err('A push "endpoint" is required.');
  if (!isObject(keys) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return err('Push subscription keys (p256dh, auth) are required.');
  }
  return ok({ endpoint: input.endpoint, p256dh: keys.p256dh, auth: keys.auth });
}

export interface NotificationPrefsPatch {
  pushNewChapter?: boolean;
  pushScheduled?: boolean;
  pushSourceDown?: boolean;
}

/** Validate a partial notification-prefs update: any subset of the boolean toggles. */
export function parseNotificationPrefsPatch(input: unknown): ParseResult<NotificationPrefsPatch> {
  if (!isObject(input)) return err('Expected a JSON object.');
  const patch: NotificationPrefsPatch = {};
  for (const key of ['pushNewChapter', 'pushScheduled', 'pushSourceDown'] as const) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return err(`"${key}" must be a boolean.`);
    patch[key] = v;
  }
  return ok(patch);
}

/**
 * Authorize the cron poll endpoint. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 * When no secret is configured (local dev), allow the request.
 */
export function isAuthorizedCron(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return true;
  return authHeader === `Bearer ${secret}`;
}

/** Map the poll route's `?tier=` query to a PollTier. Only exactly `plain` narrows to the cheap
 *  FEED+PLAIN tier; anything else (missing/unknown/empty) → `all`, so a malformed trigger degrades
 *  to MORE coverage, never less. Pure. WP-43. */
export function parsePollTier(searchParams: URLSearchParams): PollTier {
  return searchParams.get('tier') === 'plain' ? 'plain' : 'all';
}
