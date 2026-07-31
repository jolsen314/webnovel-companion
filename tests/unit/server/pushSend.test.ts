import { describe, expect, test } from 'vitest';
import { classifyPushFailure, sendPushMessages, type PushSendPorts, type PushTarget, type SendOutcome } from '../../../src/server/services/pushSend';
import type { PushMessage } from '../../../src/lib/notify';

const msg = (tag: string): PushMessage => ({ title: 'T', body: 'B', url: '/x', tag });
const sub = (endpoint: string): PushTarget => ({ endpoint, p256dh: 'p', auth: 'a' });

function harness(subs: PushTarget[], outcome: (t: PushTarget, m: PushMessage) => SendOutcome) {
  const sends: { endpoint: string; tag: string }[] = [];
  const deleted: string[] = [];
  let loadCount = 0;
  const ports: PushSendPorts = {
    loadSubscriptions: async () => {
      loadCount++;
      return subs;
    },
    send: async (t, m) => {
      sends.push({ endpoint: t.endpoint, tag: m.tag });
      return outcome(t, m);
    },
    deleteSubscription: async (e) => {
      deleted.push(e);
    },
  };
  return { ports, sends, deleted, get loadCount() { return loadCount; } };
}

describe('sendPushMessages', () => {
  test('sends every message to every subscription', async () => {
    const h = harness([sub('e1'), sub('e2')], () => 'SENT');
    const summary = await sendPushMessages([msg('a'), msg('b')], h.ports);
    expect(summary).toEqual({ sent: 4, expired: 0, failed: 0 });
    expect(h.sends).toHaveLength(4);
  });

  test('no messages → nothing loaded or sent', async () => {
    const h = harness([sub('e1')], () => 'SENT');
    const summary = await sendPushMessages([], h.ports);
    expect(summary).toEqual({ sent: 0, expired: 0, failed: 0 });
    expect(h.loadCount).toBe(0);
  });

  test('an expired subscription is pruned once and skipped for remaining messages', async () => {
    const h = harness([sub('gone'), sub('ok')], (t) => (t.endpoint === 'gone' ? 'EXPIRED' : 'SENT'));
    const summary = await sendPushMessages([msg('a'), msg('b')], h.ports);
    expect(summary).toEqual({ sent: 2, expired: 1, failed: 0 });
    expect(h.deleted).toEqual(['gone']);
    expect(h.sends.filter((s) => s.endpoint === 'gone')).toHaveLength(1); // 2nd message skipped
  });

  test('a failed send is counted but the subscription is kept', async () => {
    const h = harness([sub('e1')], () => 'FAILED');
    const summary = await sendPushMessages([msg('a')], h.ports);
    expect(summary).toEqual({ sent: 0, expired: 0, failed: 1 });
    expect(h.deleted).toEqual([]);
  });
});

describe('classifyPushFailure', () => {
  test('404 Not Found → EXPIRED (subscription gone, prune it)', () => {
    expect(classifyPushFailure(404)).toBe('EXPIRED');
  });

  test('410 Gone → EXPIRED (unsubscribed, prune it)', () => {
    expect(classifyPushFailure(410)).toBe('EXPIRED');
  });

  test('403 Forbidden → EXPIRED (VAPID key mismatch — dead for us, prune it)', () => {
    expect(classifyPushFailure(403)).toBe('EXPIRED');
  });

  test('429 rate-limit → FAILED (transient, keep and retry)', () => {
    expect(classifyPushFailure(429)).toBe('FAILED');
  });

  test('500 server error → FAILED (transient, keep)', () => {
    expect(classifyPushFailure(500)).toBe('FAILED');
  });

  test('400 Bad Request → FAILED (not a gone signal, keep)', () => {
    expect(classifyPushFailure(400)).toBe('FAILED');
  });

  test('no status (network error / undefined) → FAILED (keep)', () => {
    expect(classifyPushFailure(undefined)).toBe('FAILED');
  });
});
