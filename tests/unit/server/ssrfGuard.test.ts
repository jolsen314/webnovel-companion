import { describe, expect, test } from 'vitest';
import { isBlockedIp, assertPublicUrl } from '../../../src/server/render/ssrfGuard';

describe('isBlockedIp', () => {
  test.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata / link-local
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1', // multicast
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
  ])('blocks non-public %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  test.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe('assertPublicUrl', () => {
  const resolveTo = (address: string) => async () => [{ address }];

  test('allows an http(s) URL that resolves to a public address', async () => {
    const u = await assertPublicUrl('https://reader.example/novel/a', resolveTo('93.184.216.34'));
    expect(u.hostname).toBe('reader.example');
  });

  test('rejects a non-http(s) scheme', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', resolveTo('93.184.216.34'))).rejects.toThrow();
  });

  test('rejects localhost by name', async () => {
    await expect(assertPublicUrl('http://localhost/admin', resolveTo('93.184.216.34'))).rejects.toThrow();
  });

  test('rejects a host that resolves to a private address (DNS-based SSRF)', async () => {
    await expect(assertPublicUrl('http://sneaky.example/', resolveTo('169.254.169.254'))).rejects.toThrow();
  });

  test('rejects a malformed URL', async () => {
    await expect(assertPublicUrl('not a url', resolveTo('93.184.216.34'))).rejects.toThrow();
  });
});
