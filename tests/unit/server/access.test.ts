import { describe, expect, test } from 'vitest';
import { isPublicPath } from '../../../src/server/auth/access';

describe('isPublicPath', () => {
  test.each(['/login', '/api/auth/login', '/api/auth/logout', '/api/cron/poll', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/_next/static/x.css'])(
    'allows %s without a session',
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  test.each(['/', '/add', '/completed', '/api/series', '/api/series/abc', '/api/push/subscribe'])(
    'gates %s behind the session',
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});
