import { lookup } from 'node:dns/promises';

/**
 * SSRF guard for the render endpoint (WP-17b). An authenticated caller could otherwise
 * point the headless browser at internal/metadata addresses (169.254.169.254, RFC1918,
 * loopback). We reject non-http(s) schemes and any host that resolves to a non-public IP.
 * The IP-range check is pure and tested; DNS is injected.
 */

/** True if an IPv4/IPv6 literal is loopback, private, link-local, CGNAT, or otherwise not publicly routable. */
export function isBlockedIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 127) return true; // this-network / loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true; // loopback / unspecified
  if (v6.startsWith('::ffff:')) return isBlockedIp(v6.slice('::ffff:'.length)); // IPv4-mapped
  if (v6.startsWith('fe80:')) return true; // link-local
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local fc00::/7
  return false;
}

/** Internal service-discovery suffixes that shouldn't be reachable regardless of DNS. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.svc'];

type Resolver = (host: string) => Promise<{ address: string }[]>;

const defaultResolver: Resolver = (host) => lookup(host, { all: true });

/**
 * Parse and validate a URL for outbound rendering. Throws if the scheme isn't http(s),
 * the host is an obvious internal name, or any resolved address is non-public.
 */
export async function assertPublicUrl(raw: string, resolver: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error('Blocked host.');
  }

  const addresses = await resolver(host);
  if (addresses.length === 0) throw new Error('Host did not resolve.');
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new Error('URL resolves to a non-public address.');
  }
  return url;
}
