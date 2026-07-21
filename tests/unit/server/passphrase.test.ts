import { describe, expect, test } from 'vitest';
import { hashPassphrase, verifyPassphrase } from '../../../src/server/auth/passphrase';

describe('passphrase hashing (scrypt)', () => {
  test('a passphrase verifies against its own hash', () => {
    const hash = hashPassphrase('correct horse battery staple');
    expect(verifyPassphrase('correct horse battery staple', hash)).toBe(true);
  });

  test('a wrong passphrase does not verify', () => {
    const hash = hashPassphrase('the-real-one');
    expect(verifyPassphrase('a-guess', hash)).toBe(false);
  });

  test('hashing is salted: the same passphrase yields different hashes, both valid', () => {
    const p = 'same-pass';
    const h1 = hashPassphrase(p);
    const h2 = hashPassphrase(p);
    expect(h1).not.toBe(h2);
    expect(verifyPassphrase(p, h1)).toBe(true);
    expect(verifyPassphrase(p, h2)).toBe(true);
  });

  test('the hash contains no "$" — survives dotenv-expand in .env files', () => {
    expect(hashPassphrase('anything')).not.toContain('$');
  });

  test('a malformed stored hash returns false, never throws', () => {
    expect(verifyPassphrase('x', 'garbage')).toBe(false);
    expect(verifyPassphrase('x', '')).toBe(false);
    expect(verifyPassphrase('x', 'scrypt$nothex$nothex')).toBe(false);
  });
});
