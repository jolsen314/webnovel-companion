import { db } from '../db';
import { getCurrentUserId } from '../user';
import type { NotificationPrefsPatch } from '../api/validation';

/**
 * Per-user push notification preferences (WP-09). A disabled type still surfaces in-app
 * (source health, unread counts) — it just isn't pushed. Absent row → sensible defaults.
 */
export interface NotificationPrefsView {
  pushNewChapter: boolean;
  pushScheduled: boolean;
  pushSourceDown: boolean;
}

const DEFAULTS: NotificationPrefsView = { pushNewChapter: true, pushScheduled: true, pushSourceDown: false };

const toView = (row: NotificationPrefsView): NotificationPrefsView => ({
  pushNewChapter: row.pushNewChapter,
  pushScheduled: row.pushScheduled,
  pushSourceDown: row.pushSourceDown,
});

export async function getNotificationPrefs(): Promise<NotificationPrefsView> {
  const row = await db.notificationPrefs.findUnique({ where: { userId: getCurrentUserId() } });
  return row ? toView(row) : { ...DEFAULTS };
}

export async function updateNotificationPrefs(patch: NotificationPrefsPatch): Promise<NotificationPrefsView> {
  const userId = getCurrentUserId();
  const row = await db.notificationPrefs.upsert({ where: { userId }, create: { userId, ...patch }, update: { ...patch } });
  return toView(row);
}
