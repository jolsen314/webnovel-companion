/**
 * Notification copy (pure). Turns normalized poll/schedule signals into ready-to-send
 * push messages. Next-free and side-effect-free so it's unit-tested directly; the cron
 * binding maps effects → signals and hands the messages to the sender.
 *
 * Messages come out in a fixed category priority — new chapters, then predicted
 * (scheduled) releases, then source-down alerts — and preserve input order within a
 * category (no sorting).
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

export interface NotifyInput {
  /** Resolve a series id to its display title (binding preloads these). */
  seriesTitle: (seriesId: string) => string;
  newChapters: { seriesId: string; count: number }[];
  scheduledReleases: { seriesId: string; eventKind: ReleaseEventKind }[];
  sourcesDown: { seriesId: string; host: string }[];
}

export function buildPushMessages(input: NotifyInput): PushMessage[] {
  const { seriesTitle } = input;
  const messages: PushMessage[] = [];

  for (const { seriesId, count } of input.newChapters) {
    if (count <= 0) continue;
    messages.push({
      title: seriesTitle(seriesId),
      body: `${count} new chapter${count === 1 ? '' : 's'}`,
      url: `/series/${seriesId}`,
      tag: `new-${seriesId}`,
    });
  }

  for (const { seriesId, eventKind } of input.scheduledReleases) {
    messages.push({
      title: seriesTitle(seriesId),
      body: eventKind === 'UNLOCKED' ? 'An advance chapter likely went free' : 'A new chapter is likely up',
      url: `/series/${seriesId}`,
      tag: `sched-${seriesId}`,
    });
  }

  for (const { seriesId, host } of input.sourcesDown) {
    messages.push({
      title: 'Source may be down',
      body: `${seriesTitle(seriesId)} — ${host} isn't responding`,
      url: `/series/${seriesId}`,
      tag: `down-${seriesId}`,
    });
  }

  return messages;
}
