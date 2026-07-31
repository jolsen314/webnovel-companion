import type { PushMessage } from '../../lib/notify';

/**
 * Push fan-out (orchestration, injected ports). Sends each message to every stored
 * subscription and prunes ones the push service reports gone (404/410 → EXPIRED).
 * The transport (`web-push`) and DB are injected so this unit-tests with fakes; the
 * Prisma/web-push binding lives at the edge.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendOutcome = 'SENT' | 'EXPIRED' | 'FAILED';

/** Classify a failed Web Push send by the endpoint's HTTP status into a prune-or-keep outcome.
 *  `EXPIRED` (prune) = the subscription is permanently dead *for us*: 404 Not Found / 410 Gone
 *  (unsubscribed or expired) and 403 Forbidden (VAPID key mismatch — created under different keys,
 *  so it can never accept our pushes; also the desired behavior on an intentional key rotation).
 *  Everything else — 429 rate-limit, 5xx, or a network error with no status — is `FAILED`
 *  (transient): keep the subscription and retry next run. Pure. */
export function classifyPushFailure(status: number | undefined): Exclude<SendOutcome, 'SENT'> {
  return status === 403 || status === 404 || status === 410 ? 'EXPIRED' : 'FAILED';
}

export interface PushSendPorts {
  loadSubscriptions: () => Promise<PushTarget[]>;
  send: (target: PushTarget, message: PushMessage) => Promise<SendOutcome>;
  /** Remove a subscription the push service says is gone. */
  deleteSubscription: (endpoint: string) => Promise<void>;
}

export interface SendSummary {
  sent: number;
  expired: number;
  failed: number;
}

export async function sendPushMessages(messages: PushMessage[], ports: PushSendPorts): Promise<SendSummary> {
  if (messages.length === 0) return { sent: 0, expired: 0, failed: 0 };

  const subscriptions = await ports.loadSubscriptions();
  const expired = new Set<string>();
  let sent = 0;
  let failed = 0;

  for (const target of subscriptions) {
    for (const message of messages) {
      if (expired.has(target.endpoint)) continue; // already gone — skip the rest
      const outcome = await ports.send(target, message);
      if (outcome === 'EXPIRED') expired.add(target.endpoint);
      else if (outcome === 'SENT') sent++;
      else failed++;
    }
  }

  for (const endpoint of expired) await ports.deleteSubscription(endpoint);
  return { sent, expired: expired.size, failed };
}
