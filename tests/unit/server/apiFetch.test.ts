import { describe, expect, test, vi } from 'vitest';
import { fetchApiPages } from '../../../src/server/services/apiFetch';
import type { ApiDescriptor } from '../../../src/lib/feeds/apiAdapter';
import type { PoliteResult } from '../../../src/lib/feeds/fetch';

const ok = (body: string): PoliteResult => ({ outcome: 'SUCCESS', status: 200, notModified: false, body, etag: null, lastModified: null, finalUrl: 'x' });
const desc = (perPage: number, maxPages?: number): ApiDescriptor => ({ urlField: 'url', titleField: 't', pagination: { pageParam: 'page', perPage, maxPages } });
const items = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ url: `/c${i}`, t: `C${i}` })));
const pageOf = (u: string) => new URL(u).searchParams.get('page');
/** Narrow a PoliteResult to its SUCCESS body (throws with the real outcome otherwise). */
const body = (res: PoliteResult): string => {
  if (res.outcome !== 'SUCCESS') throw new Error(`expected SUCCESS, got ${res.outcome}`);
  return res.body;
};

describe('fetchApiPages — precondition', () => {
  test('rejects when descriptor.pagination is missing', async () => {
    const noPaginationDesc: ApiDescriptor = { urlField: 'u', titleField: 't' };
    const fetch = vi.fn(async () => ok('[]'));
    await expect(
      fetchApiPages('https://api.example/ch', noPaginationDesc, 'PLAIN', { fetch }),
    ).rejects.toThrow(/pagination/i);
  });
});

describe('fetchApiPages — PLAIN', () => {
  test('unions pages, stops on the short page, exact fetch count', async () => {
    const fetch = vi.fn(async (u: string) => ok(pageOf(u) === '2' ? items(18) : items(200)));
    const res = await fetchApiPages('https://api.example/ch?per_page=200', desc(200), 'PLAIN', { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(body(res))).toHaveLength(218);
  });
  test('caps at maxPages and logs', async () => {
    const fetch = vi.fn(async (_u: string) => ok(items(200)));
    const log = vi.fn();
    const res = await fetchApiPages('https://api.example/ch', desc(200, 3), 'PLAIN', { fetch }, log);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(body(res))).toHaveLength(600);
  });
  test('a page failure surfaces the failure outcome', async () => {
    const fetch = vi.fn(async (u: string) => (pageOf(u) === '2' ? ({ outcome: 'HTTP_5XX', status: 502 } as PoliteResult) : ok(items(200))));
    const res = await fetchApiPages('https://api.example/ch', desc(200), 'PLAIN', { fetch });
    expect(res.outcome).toBe('HTTP_5XX');
  });

  test('honors a top-level ApiDescriptor.listPath when pagination.listPath is unset', async () => {
    // Nested item-array path set at the TOP level only — pagination has no listPath of its own.
    // If the loop only reads pg.listPath (undefined), itemsAt() finds nothing at the root → 0
    // items/page → isLastPage(0, perPage) is true → the union stops after page 1 with ZERO
    // chapters, silently. This asserts the descriptor's top-level listPath is honored instead.
    const nestedDesc: ApiDescriptor = {
      listPath: 'data.chapters',
      urlField: 'url',
      titleField: 't',
      pagination: { pageParam: 'page', perPage: 2 },
    };
    const page = (items: Array<{ url: string; t: string }>) => JSON.stringify({ data: { chapters: items } });
    const fetch = vi.fn(async (u: string) =>
      pageOf(u) === '2'
        ? ok(page([{ url: '/c2', t: 'C2' }])) // short page (1 < perPage 2) → last page
        : ok(page([{ url: '/c0', t: 'C0' }, { url: '/c1', t: 'C1' }])),
    );
    const res = await fetchApiPages('https://api.example/ch', nestedDesc, 'PLAIN', { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(body(res))).toHaveLength(3);
  });
});

describe('fetchApiPages — RENDER (one-browser guarantee)', () => {
  test('calls renderFetch EXACTLY ONCE for a multi-page series, passing pagination', async () => {
    const renderFetch = vi.fn(async (_url: string, _opts?: { pagination?: unknown }) => ok(items(1300)));
    const fetch = vi.fn(async (_u: string) => ok(items(0)));
    const res = await fetchApiPages('https://api.example/ch', desc(200), 'RENDER', { fetch, renderFetch });
    expect(renderFetch).toHaveBeenCalledTimes(1);
    expect(renderFetch.mock.calls[0]![1]).toMatchObject({ pagination: { pageParam: 'page', perPage: 200 } });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(body(res))).toHaveLength(1300);
  });

  test('passes the top-level ApiDescriptor.listPath through as pagination.listPath when unset on pagination', async () => {
    const nestedDesc: ApiDescriptor = {
      listPath: 'data.chapters',
      urlField: 'url',
      titleField: 't',
      pagination: { pageParam: 'page', perPage: 200 },
    };
    const renderFetch = vi.fn(async (_url: string, _opts?: { pagination?: unknown }) => ok(items(5)));
    const res = await fetchApiPages('https://api.example/ch', nestedDesc, 'RENDER', { fetch: vi.fn(), renderFetch });
    expect(renderFetch.mock.calls[0]![1]).toMatchObject({
      pagination: { pageParam: 'page', perPage: 200, listPath: 'data.chapters' },
    });
    expect(JSON.parse(body(res))).toHaveLength(5);
  });
});
