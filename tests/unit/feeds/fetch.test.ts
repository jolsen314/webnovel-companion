import { describe, expect, test } from 'vitest';
import { politeFetch, type FetchLike, type HttpResponse } from '../../../src/lib/feeds/fetch';

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

describe('politeFetch', () => {
  test('200 → SUCCESS with body and captured etag/last-modified; sends realistic headers', async () => {
    const { impl, calls } = stub(
      response(200, {
        body: '<rss></rss>',
        headers: { etag: '"abc"', 'last-modified': 'Wed, 15 Jul 2026 00:00:00 GMT' },
      }),
    );

    const result = await politeFetch('https://feed.example/rss', {}, impl);

    expect(result).toEqual({
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
    expect(await politeFetch('u', {}, stub(response(404)).impl)).toEqual({ outcome: 'HTTP_4XX', status: 404 });
    expect(await politeFetch('u', {}, stub(response(503)).impl)).toEqual({ outcome: 'HTTP_5XX', status: 503 });
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
    expect(await politeFetch('u', {}, stub(err).impl)).toEqual({ outcome: expected });
  });

  test('an aborted request (timeout) → TIMEOUT', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(await politeFetch('u', {}, stub(err).impl)).toEqual({ outcome: 'TIMEOUT' });
  });
});
