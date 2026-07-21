import { db } from '../db';
import { getCurrentUserId } from '../user';
import type { PushSubscriptionInput } from '../api/validation';

/** Store (or refresh) a Web Push subscription for the current user. Sending is WP-09. */
export async function savePushSubscription(sub: PushSubscriptionInput): Promise<void> {
  const userId = getCurrentUserId();
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    update: { userId, p256dh: sub.p256dh, auth: sub.auth },
  });
}
