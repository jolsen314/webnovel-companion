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
