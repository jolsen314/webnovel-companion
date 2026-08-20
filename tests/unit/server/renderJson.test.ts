import { describe, expect, test } from 'vitest';
import { collectJsonResult, type JsonPageFetch } from '../../../src/server/render/renderJson';

/**
 * WP-45b: unit coverage for the actual orchestration `renderPage` uses to honor pagination —
 * pulled out of renderPage.ts specifically so it's testable without Puppeteer. `fetchPage` here
 * stands in for `(u) => page.evaluate(jsonPageFetch, u)`; this test proves the loop/union/stop
 * logic renderPage wires in is correct, not just that a same-shaped helper exists elsewhere.
 */
describe('collectJsonResult', () => {
  test('no pagination: a single fetch, pages=1', async () => {
    const calls: string[] = [];
    const fetchPage: JsonPageFetch = async (u) => {
      calls.push(u);
      return { status: 200, body: '[{"id":1}]' };
    };
    const result = await collectJsonResult('https://api.example/ch', undefined, fetchPage);
    expect(result).toEqual({ status: 200, body: '[{"id":1}]', pages: 1 });
    expect(calls).toEqual(['https://api.example/ch']);
  });

  test('pagination: unions pages, requesting each pageParam value, until a short page', async () => {
    const calls: string[] = [];
    const fetchPage: JsonPageFetch = async (u) => {
      calls.push(u);
      if (u.includes('page=1')) return { status: 200, body: JSON.stringify([{ id: 1 }, { id: 2 }]) };
      return { status: 200, body: JSON.stringify([{ id: 3 }]) }; // short → last page
    };
    const result = await collectJsonResult('https://api.example/ch', { pageParam: 'page', perPage: 2 }, fetchPage);
    expect(result).toEqual({ status: 200, body: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]), pages: 2 });
    expect(calls).toEqual(['https://api.example/ch?page=1', 'https://api.example/ch?page=2']);
  });

  test('pagination: stops at maxPages even when the last page fetched is still full', async () => {
    const fetchPage: JsonPageFetch = async () => ({ status: 200, body: JSON.stringify([{ id: 1 }, { id: 2 }]) });
    const result = await collectJsonResult(
      'https://api.example/ch',
      { pageParam: 'page', perPage: 2, maxPages: 3 },
      fetchPage,
    );
    expect(result?.pages).toBe(3);
    expect(JSON.parse(result?.body ?? '[]')).toHaveLength(6);
  });

  test('a non-JSON / failed page fetch (null) discards the whole result — caller falls back to DOM', async () => {
    const fetchPage: JsonPageFetch = async (u) =>
      u.includes('page=1') ? { status: 200, body: '[{"id":1},{"id":2}]' } : null;
    const result = await collectJsonResult('https://api.example/ch', { pageParam: 'page', perPage: 2 }, fetchPage);
    expect(result).toBeNull();
  });

  test('pagination: extracts each page via listPath before unioning', async () => {
    const fetchPage: JsonPageFetch = async (u) => {
      const n = u.includes('page=1') ? 1 : 2;
      const items = n === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
      return { status: 200, body: JSON.stringify({ data: { chapters: items } }) };
    };
    const result = await collectJsonResult(
      'https://api.example/ch',
      { pageParam: 'page', perPage: 2, listPath: 'data.chapters' },
      fetchPage,
    );
    expect(JSON.parse(result?.body ?? '[]')).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result?.pages).toBe(2);
  });
});
