import { NextResponse } from 'next/server';
import { verifyPassphrase } from '../../../../server/auth/passphrase';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '../../../../server/auth/session';

// scrypt needs the Node runtime (not edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.AUTH_SECRET;
  const hash = process.env.AUTH_PASSWORD_HASH;
  if (!secret || !hash) {
    return NextResponse.json({ error: 'Access is not configured on the server.' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const passphrase = (body as { passphrase?: unknown }).passphrase;
  if (typeof passphrase !== 'string' || !verifyPassphrase(passphrase, hash)) {
    await new Promise((r) => setTimeout(r, 400)); // blunt brute-force a little
    return NextResponse.json({ error: 'That passphrase didn’t match.' }, { status: 401 });
  }

  const token = await signSession(secret, { now: Date.now(), ttlMs: SESSION_TTL_MS });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}
