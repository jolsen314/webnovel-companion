/**
 * The gate's allowlist: paths reachable without a session cookie. Everything else
 * (all pages + APIs) requires auth. `/api/cron/poll` and `/api/render` are here because
 * they authenticate with their own Bearer secret (CRON_SECRET / RENDER_SECRET), not the
 * session cookie — both are called server-to-server. Pure.
 */
const PUBLIC_EXACT = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/cron/poll',
  '/api/render',
  '/manifest.webmanifest',
  '/sw.js',
  '/icon.svg',
  '/favicon.ico',
  '/robots.txt',
]);

const PUBLIC_PREFIXES = ['/_next/', '/icons/'];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
