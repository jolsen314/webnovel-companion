import { describe, expect, test } from 'vitest';
import {
  parseAddSeriesBody,
  parseSeriesUpdate,
  parsePushSubscription,
  parseNotificationPrefsPatch,
  isAuthorizedCron,
  parsePollTier,
} from '../../../src/server/api/validation';

describe('parseAddSeriesBody', () => {
  test('accepts a valid http(s) url, with optional title', () => {
    expect(parseAddSeriesBody({ url: 'https://x.example/novel/a' })).toEqual({
      ok: true,
      value: { url: 'https://x.example/novel/a' },
    });
    expect(parseAddSeriesBody({ url: 'https://x.example/a', title: 'A' })).toEqual({
      ok: true,
      value: { url: 'https://x.example/a', title: 'A' },
    });
  });

  test.each([
    [{}, 'missing url'],
    [{ url: 42 }, 'non-string url'],
    [{ url: 'not a url' }, 'unparseable'],
    [{ url: 'ftp://x.example/a' }, 'non-http scheme'],
    [{ url: 'javascript:alert(1)' }, 'dangerous scheme'],
    [null, 'not an object'],
  ])('rejects %j (%s)', (input, _why) => {
    expect(parseAddSeriesBody(input).ok).toBe(false);
  });
});

describe('parseSeriesUpdate', () => {
  test('accepts a subset of valid fields', () => {
    expect(parseSeriesUpdate({ status: 'COMPLETED', rating: 5 })).toEqual({
      ok: true,
      value: { status: 'COMPLETED', rating: 5 },
    });
    expect(parseSeriesUpdate({ lastReadChapterId: 'ch1', notes: 'good' }).ok).toBe(true);
  });

  test.each([
    [{ status: 'NOPE' }, 'invalid status'],
    [{ rating: 6 }, 'rating out of range'],
    [{ rating: 2.5 }, 'non-integer rating'],
    [{}, 'no fields to update'],
    [{ notes: 123 }, 'non-string notes'],
  ])('rejects %j (%s)', (input, _why) => {
    expect(parseSeriesUpdate(input).ok).toBe(false);
  });
});

describe('parsePushSubscription', () => {
  test('accepts the web-push subscription shape', () => {
    const sub = { endpoint: 'https://push.example/xyz', keys: { p256dh: 'p', auth: 'a' } };
    expect(parsePushSubscription(sub)).toEqual({
      ok: true,
      value: { endpoint: 'https://push.example/xyz', p256dh: 'p', auth: 'a' },
    });
  });

  test.each([
    [{ endpoint: 'https://push.example/x' }, 'missing keys'],
    [{ endpoint: 'https://push.example/x', keys: { p256dh: 'p' } }, 'missing auth'],
    [{ keys: { p256dh: 'p', auth: 'a' } }, 'missing endpoint'],
  ])('rejects %j (%s)', (input, _why) => {
    expect(parsePushSubscription(input).ok).toBe(false);
  });
});

describe('parseNotificationPrefsPatch', () => {
  test('accepts a partial of boolean toggles', () => {
    expect(parseNotificationPrefsPatch({ pushSourceDown: true })).toEqual({ ok: true, value: { pushSourceDown: true } });
    expect(parseNotificationPrefsPatch({ pushNewChapter: false, pushScheduled: true })).toEqual({
      ok: true,
      value: { pushNewChapter: false, pushScheduled: true },
    });
  });

  test('ignores unknown fields', () => {
    expect(parseNotificationPrefsPatch({ pushSourceDown: true, wat: 5 })).toEqual({
      ok: true,
      value: { pushSourceDown: true },
    });
  });

  test('rejects a non-object', () => {
    expect(parseNotificationPrefsPatch(null).ok).toBe(false);
  });

  test('rejects a non-boolean toggle', () => {
    expect(parseNotificationPrefsPatch({ pushScheduled: 'yes' }).ok).toBe(false);
  });
});

describe('isAuthorizedCron', () => {
  test('requires a matching Bearer secret when one is configured', () => {
    expect(isAuthorizedCron('Bearer s3cret', 's3cret')).toBe(true);
    expect(isAuthorizedCron('Bearer wrong', 's3cret')).toBe(false);
    expect(isAuthorizedCron(null, 's3cret')).toBe(false);
  });

  test('allows the request in dev when no secret is configured', () => {
    expect(isAuthorizedCron(null, undefined)).toBe(true);
  });
});

describe('parsePollTier', () => {
  const parse = (qs: string) => parsePollTier(new URLSearchParams(qs));

  test('?tier=plain → plain', () => {
    expect(parse('tier=plain')).toBe('plain');
  });

  test('no tier param → all (full poll)', () => {
    expect(parse('')).toBe('all');
  });

  test('unknown tier value → all (fail-safe to full poll)', () => {
    expect(parse('tier=render')).toBe('all');
  });

  test('empty tier value → all', () => {
    expect(parse('tier=')).toBe('all');
  });
});
