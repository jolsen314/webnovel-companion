import { describe, expect, test } from 'vitest';
import { signSession, verifySession } from '../../../src/server/auth/session';

const SECRET = 'test-signing-secret';
const HOUR = 3_600_000;

describe('session token (HMAC)', () => {
  test('a freshly signed token verifies within its lifetime', async () => {
    const now = 1_000_000;
    const token = await signSession(SECRET, { now, ttlMs: HOUR });
    expect(await verifySession(SECRET, token, now + 1000)).toBe(true);
  });

  test('an expired token does not verify', async () => {
    const now = 1_000_000;
    const token = await signSession(SECRET, { now, ttlMs: HOUR });
    expect(await verifySession(SECRET, token, now + HOUR + 1)).toBe(false);
  });

  test('a token signed with a different secret does not verify', async () => {
    const token = await signSession('other-secret', { now: 0, ttlMs: HOUR });
    expect(await verifySession(SECRET, token, 1000)).toBe(false);
  });

  test('a tampered token does not verify', async () => {
    const token = await signSession(SECRET, { now: 0, ttlMs: HOUR });
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'b' : 'a');
    expect(await verifySession(SECRET, tampered, 1000)).toBe(false);
  });

  test('malformed tokens return false, never throw', async () => {
    expect(await verifySession(SECRET, 'not-a-token', 0)).toBe(false);
    expect(await verifySession(SECRET, '', 0)).toBe(false);
  });
});
