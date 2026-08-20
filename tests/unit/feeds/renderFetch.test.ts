import { describe, expect, test } from 'vitest';
import { makeRenderFetch, type RenderHttp } from '../../../src/lib/feeds/renderFetch';

const config = { endpoint: 'https://renderer.example/render', secret: 'sek' };

/** Fake render-service HTTP that returns a canned response and records the request. */
function http(response: { status: number; ok: boolean; payload?: unknown }): {
  fn: RenderHttp;
  calls: { endpoint: string; init: { method: string; headers: Record<string, string>; body: string } }[];
} {
  const calls: { endpoint: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fn: RenderHttp = async (endpoint, init) => {
    calls.push({ endpoint, init });
    return { status: response.status, ok: response.ok, json: async () => response.payload };
  };
  return { fn, calls };
}

describe('makeRenderFetch', () => {
  test('a successful render maps to SUCCESS with the rendered HTML and final url', async () => {
    const h = http({ status: 200, ok: true, payload: { status: 200, finalUrl: 'https://x.example/a/', html: '<ul>toc</ul>' } });
    const res = await makeRenderFetch(config, h.fn)('https://x.example/a/');

    expect(res).toMatchObject({
      outcome: 'SUCCESS',
      status: 200,
      notModified: false,
      body: '<ul>toc</ul>',
      finalUrl: 'https://x.example/a/',
    });
  });

  test('sends the target url in the body and the secret as a bearer token', async () => {
    const h = http({ status: 200, ok: true, payload: { status: 200, finalUrl: 'u', html: '' } });
    await makeRenderFetch(config, h.fn)('https://x.example/a/');

    expect(h.calls[0]!.endpoint).toBe(config.endpoint);
    expect(JSON.parse(h.calls[0]!.init.body)).toEqual({ url: 'https://x.example/a/' });
    expect(h.calls[0]!.init.headers.authorization).toBe('Bearer sek');
  });

  test('a 4xx from the rendered page maps to HTTP_4XX', async () => {
    const h = http({ status: 200, ok: true, payload: { status: 403, finalUrl: 'u', html: '' } });
    expect((await makeRenderFetch(config, h.fn)('u')).outcome).toBe('HTTP_4XX');
  });

  test('a renderer-service 5xx (renderer itself failing) maps to HTTP_5XX', async () => {
    const h = http({ status: 502, ok: false, payload: {} });
    expect((await makeRenderFetch(config, h.fn)('u')).outcome).toBe('HTTP_5XX');
  });

  test('a network error is a soft (retryable) failure', async () => {
    const fn: RenderHttp = async () => {
      throw new Error('connection reset');
    };
    expect((await makeRenderFetch(config, fn)('u')).outcome).toBe('TIMEOUT');
  });

  test('forwards pagination in the POST body', async () => {
    let sentBody = '';
    const http = async (_endpoint: string, init: { body: string }) => {
      sentBody = init.body;
      return { status: 200, ok: true, json: async () => ({ status: 200, finalUrl: 'u', html: '[]' }) };
    };
    const rf = makeRenderFetch({ endpoint: 'https://r.example' }, http);
    await rf('https://api.example/ch', { pagination: { pageParam: 'page', perPage: 200 } });
    expect(JSON.parse(sentBody)).toMatchObject({ url: 'https://api.example/ch', pagination: { pageParam: 'page', perPage: 200 } });
  });
});
