import { NextResponse, type NextRequest } from 'next/server';
import { isPublicPath } from './server/auth/access';
import { SESSION_COOKIE, verifySession } from './server/auth/session';

/**
 * The single-user gate. Runs on the edge for every request except static assets.
 * Public paths (login, auth endpoints, cron, PWA files) pass through; everything
 * else needs a valid session cookie.
 *
 * Fail-safe posture: with no AUTH_SECRET configured the gate is OFF in development
 * (convenience) but CLOSED in production (so a forgotten env var never ships an open
 * API). Configure AUTH_SECRET + AUTH_PASSWORD_HASH to enable it.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return deny(request); // production must be configured — fail closed
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySession(secret, token, Date.now()))) return NextResponse.next();

  return deny(request);
}

function deny(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
