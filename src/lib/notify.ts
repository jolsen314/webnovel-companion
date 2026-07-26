/**
 * Notification copy (pure). Turns normalized poll/schedule signals into ready-to-send
 * push messages. Next-free and side-effect-free so it's unit-tested directly; the cron
 * binding maps effects → signals and hands the messages to the sender.
 *
 * Messages come out in a fixed category priority — new chapters, then predicted
 * (scheduled) releases, then source-down alerts — and preserve input order within a
 * category (no sorting).
 *
 * Privacy: the *work's name is kept out of the always-visible notification `title`*
 * (generic category there, series name in the `body`) so a lock-screen glance doesn't
 * reveal what the owner reads. This cooperates with the OS "show previews: when unlocked"
 * setting, which masks the body until the notification is expanded/unlocked — the web
 * can't force that on iOS, so the owner should set previews to "when unlocked". The
 * source-down host also lives in the body for the same reason.
 */

import type { ReleaseEventKind } from './schedule';

export interface PushMessage {
  title: string;
  body: string;
  /** Deep link for the service worker's notificationclick (e.g. /series/<id>). */
  url: string;
  /** Replace/collapse tag so re-sends for the same series don't stack. */
  tag: string;
}

/**
 * Per-type push toggles; a disabled type stays an in-app surface only. This is just the
 * value shape — persisted prefs are stored per-user (keyed by `userId`, like the rest of
 * the schema), so a future multi-user step folds them under a `User` with no change here.
 */
export interface PushPrefs {
  newChapters: boolean;
  scheduledReleases: boolean;
  sourcesDown: boolean;
}

export interface NotifyInput {
  /** Resolve a series id to its display title (binding preloads these). */
  seriesTitle: (seriesId: string) => string;
  newChapters: { seriesId: string; count: number }[];
  scheduledReleases: { seriesId: string; eventKind: ReleaseEventKind }[];
  sourcesDown: { seriesId: string; host: string }[];
  /** Which categories to actually push. Omitted → all enabled. */
  push?: PushPrefs;
}

export function buildPushMessages(input: NotifyInput): PushMessage[] {
  const { seriesTitle } = input;
  const push = input.push ?? { newChapters: true, scheduledReleases: true, sourcesDown: true };
  const messages: PushMessage[] = [];

  // Privacy: the work's name goes in the BODY, never the always-visible title — so a
  // lock-screen glance shows only a generic category. The OS "previews when unlocked"
  // setting then masks the body until the notification is expanded/unlocked.
  for (const { seriesId, count } of push.newChapters ? input.newChapters : []) {
    if (count <= 0) continue;
    messages.push({
      title: count === 1 ? 'New chapter' : 'New chapters',
      body: count === 1 ? seriesTitle(seriesId) : `${seriesTitle(seriesId)} — ${count} new`,
      url: `/series/${seriesId}`,
      tag: `new-${seriesId}`,
    });
  }

  for (const { seriesId, eventKind } of push.scheduledReleases ? input.scheduledReleases : []) {
    messages.push({
      title: eventKind === 'UNLOCKED' ? 'Likely now free' : 'New chapter likely',
      body: seriesTitle(seriesId),
      url: `/series/${seriesId}`,
      tag: `sched-${seriesId}`,
    });
  }

  for (const { seriesId, host } of push.sourcesDown ? input.sourcesDown : []) {
    messages.push({
      title: 'Source may be down',
      body: `${seriesTitle(seriesId)} — ${host} isn't responding`,
      url: `/series/${seriesId}`,
      tag: `down-${seriesId}`,
    });
  }

  return messages;
}
