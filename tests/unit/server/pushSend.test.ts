import { describe, expect, test } from 'vitest';
import { sendPushMessages, type PushSendPorts, type PushTarget, type SendOutcome } from '../../../src/server/services/pushSend';
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
