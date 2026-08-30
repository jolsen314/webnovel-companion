import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Passphrase hashing for the single-user gate. We store a scrypt hash (salted),
 * never the raw passphrase — so a leaked env var exposes no usable secret. Node
 * runtime only (used by the login route + the hash-generation script), never in
 * the proxy gate. Format: `scrypt:<saltHex>:<hashHex>` — colon-separated, NOT `$`,
 * so it survives dotenv-expand (which would treat `$…` as variable interpolation).
 */
const PREFIX = 'scrypt';
const KEYLEN = 64;

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase, salt, KEYLEN);
  return `${PREFIX}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  try {
    const salt = Buffer.from(parts[1]!, 'hex');
    const expected = Buffer.from(parts[2]!, 'hex');
    if (salt.length === 0 || expected.length !== KEYLEN) return false;
    const actual = scryptSync(passphrase, salt, KEYLEN);
    return timingSafeEqual(actual, expected); // constant-time
  } catch {
    return false;
  }
}
