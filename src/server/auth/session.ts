/**
 * Signed session token for the single-user gate. HMAC-SHA256 via Web Crypto so the
 * same verify runs in edge middleware and Node routes. The token carries only an
 * expiry; a valid signature means "the one user authenticated". Not a JWT library —
 * no dependency, minimal surface.
 */
export const SESSION_COOKIE = 'wc_session';
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — it's your own device

const encoder = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export interface SignOpts {
  now: number;
  ttlMs: number;
}

export async function signSession(secret: string, opts: SignOpts): Promise<string> {
  const payload = toB64url(encoder.encode(JSON.stringify({ exp: opts.now + opts.ttlMs })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toB64url(new Uint8Array(sig))}`;
}

export async function verifySession(secret: string, token: string, now: number): Promise<boolean> {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(signature), encoder.encode(payload));
    if (!ok) return false;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { exp?: number };
    return typeof claims.exp === 'number' && claims.exp > now;
  } catch {
    return false;
  }
}
