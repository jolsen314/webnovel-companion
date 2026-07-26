/**
 * Notification copy (pure). Turns normalized poll/schedule signals into ready-to-send
 * push messages. Next-free and side-effect-free so it's unit-tested directly; the cron
 * binding maps effects → signals and hands the messages to the sender.
 *
 * Messages come out in a fixed category priority — new chapters, then predicted
 * (scheduled) releases, then source-down alerts — and preserve input order within a
 * category (no sorting).
 *
 * TODO(privacy — WP-09 follow-up): keep the *work's title out of the always-visible
 * notification `title`* so a lock-screen preview doesn't reveal what the owner reads to
 * a passing glance. The intended shape is a generic `title` ("New chapter") with the
 * series name in the `body`, which the OS "show previews: when unlocked" setting then
 * masks until the notification is expanded/unlocked (iOS can't be forced from the web,
 * so we cooperate with that setting rather than control it). Optionally a "discreet"
 * pref. Current copy puts the series in the title — revisit before shipping push wide.
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

  for (const { seriesId, count } of push.newChapters ? input.newChapters : []) {
    if (count <= 0) continue;
    messages.push({
      title: seriesTitle(seriesId),
      body: `${count} new chapter${count === 1 ? '' : 's'}`,
      url: `/series/${seriesId}`,
      tag: `new-${seriesId}`,
    });
  }

  for (const { seriesId, eventKind } of push.scheduledReleases ? input.scheduledReleases : []) {
    messages.push({
      title: seriesTitle(seriesId),
      body: eventKind === 'UNLOCKED' ? 'An advance chapter likely went free' : 'A new chapter is likely up',
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
