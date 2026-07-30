import { describe, expect, test } from 'vitest';
import { parseRetryAfter, politeFetch, type FetchLike, type HttpResponse } from '../../../src/lib/feeds/fetch';

/** Build a fake HttpResponse. Header lookups are case-insensitive, like the real thing. */
function response(
  status: number,
  opts: { body?: string; headers?: Record<string, string>; url?: string } = {},
): HttpResponse {
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    url: opts.url ?? 'https://feed.example/',
    text: async () => opts.body ?? '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

/** A fetch stub that records how it was called and returns a fixed response (or throws). */
function stub(result: HttpResponse | Error) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (result instanceof Error) throw result;
    return result;
  };
  return { impl, calls };
}

describe('parseRetryAfter', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  test('delta-seconds → now + seconds', () => {
    expect(parseRetryAfter('120', now)).toEqual(new Date('2026-07-29T12:02:00Z'));
  });
  test('HTTP-date → that date', () => {
    expect(parseRetryAfter('Wed, 29 Jul 2026 12:05:00 GMT', now)).toEqual(new Date('2026-07-29T12:05:00Z'));
  });
  test('null / empty / garbage → null', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});

describe('politeFetch', () => {
  test('200 → SUCCESS with body and captured etag/last-modified; sends realistic headers', async () => {
    const { impl, calls } = stub(
      response(200, {
        body: '<rss></rss>',
        headers: { etag: '"abc"', 'last-modified': 'Wed, 15 Jul 2026 00:00:00 GMT' },
      }),
    );

    const result = await politeFetch('https://feed.example/rss', {}, impl);

    expect(result).toMatchObject({
      outcome: 'SUCCESS',
      status: 200,
      notModified: false,
      body: '<rss></rss>',
      etag: '"abc"',
      lastModified: 'Wed, 15 Jul 2026 00:00:00 GMT',
      finalUrl: 'https://feed.example/',
    });
    // Realistic headers so hosts (and Cloudflare) don't reject a bare bot.
    expect(calls[0]!.init.headers['user-agent']).toBeTruthy();
    expect(calls[0]!.init.headers['accept']).toBeTruthy();
  });

  // --- branch guards (classifier implemented with the SUCCESS path above) ---

  test('conditional GET: sends validators, and a 304 → SUCCESS not-modified with no body', async () => {
    const { impl, calls } = stub(response(304));

    const result = await politeFetch(
      'https://feed.example/rss',
      { etag: '"abc"', lastModified: 'Wed, 15 Jul 2026 00:00:00 GMT' },
      impl,
    );

    expect(calls[0]!.init.headers['if-none-match']).toBe('"abc"');
    expect(calls[0]!.init.headers['if-modified-since']).toBe('Wed, 15 Jul 2026 00:00:00 GMT');
    expect(result).toMatchObject({ outcome: 'SUCCESS', notModified: true, body: '' });
  });

  test('4xx → HTTP_4XX, 5xx → HTTP_5XX (with status)', async () => {
    expect(await politeFetch('u', {}, stub(response(404)).impl)).toMatchObject({ outcome: 'HTTP_4XX', status: 404 });
    expect(await politeFetch('u', {}, stub(response(503)).impl)).toMatchObject({ outcome: 'HTTP_5XX', status: 503 });
  });

  test('a 200 domain-parking page → PARKED (source is gone despite the 200)', async () => {
    const parked = stub(response(200, { body: '<html><body>This domain is for sale. Buy this domain.</body></html>' }));
    expect(await politeFetch('u', {}, parked.impl)).toMatchObject({ outcome: 'PARKED' });
  });

  test.each([
    [{ cause: { code: 'ENOTFOUND' } }, 'DNS'],
    [{ cause: { code: 'CERT_HAS_EXPIRED' } }, 'TLS'],
    [{ cause: { code: 'ETIMEDOUT' } }, 'TIMEOUT'],
    [{ cause: { code: 'ECONNREFUSED' } }, 'TIMEOUT'],
  ])('network error %o → %s', async (props, expected) => {
    const err = Object.assign(new Error('net'), props);
    expect(await politeFetch('u', {}, stub(err).impl)).toMatchObject({ outcome: expected, retryAfter: null });
  });

  test('an aborted request (timeout) → TIMEOUT', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(await politeFetch('u', {}, stub(err).impl)).toMatchObject({ outcome: 'TIMEOUT' });
  });

  test('politeFetch surfaces the Retry-After header on a 429', async () => {
    const fake = async (): Promise<HttpResponse> => ({
      status: 429,
      url: 'https://x.example/feed/',
      headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '120' : null) },
      text: async () => '',
    });
    const res = await politeFetch('https://x.example/feed/', {}, fake);
    expect(res.outcome).toBe('HTTP_4XX'); // health classification unchanged
    expect(res.retryAfter).toBe('120');
  });
});
