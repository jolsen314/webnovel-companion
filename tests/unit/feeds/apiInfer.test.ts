import { describe, expect, test } from 'vitest';
import { inferApiDescriptors, shouldCaptureResponse, UNCONFIRMED_PREFIX } from '../../../src/lib/feeds/apiInfer';

const EP = 'https://site.example/api/v1/chapters?category=42';

describe('inferApiDescriptors', () => {
  test('root array with a full-URL field → urlField + title + number, no listPath', () => {
    const cap = {
      url: EP,
      body: JSON.stringify([
        { id: 1, title: 'Chapter 1: Start', url: 'https://site.example/read/1', order: 1 },
        { id: 2, title: 'Chapter 2: Next', url: 'https://site.example/read/2', order: 2 },
      ]),
    };
    const [hit] = inferApiDescriptors([cap]);
    expect(hit!.descriptor.urlField).toBe('url');
    expect(hit!.descriptor.titleField).toBe('title');
    expect(hit!.descriptor.numberField).toBe('order'); // prefers an order-ish key over `id`
    expect(hit!.descriptor.listPath).toBeUndefined();
    expect(hit!.descriptor.urlTemplate).toBeUndefined();
    expect(hit!.apiUrl).toBe(EP);
    expect(hit!.sampleCount).toBe(2);
  });

  test('nested list under data.chapters → listPath set', () => {
    const cap = {
      url: EP,
      body: JSON.stringify({
        data: { chapters: [{ title: 'Ch 1', url: '/r/1' }, { title: 'Ch 2', url: '/r/2' }] },
      }),
    };
    const [hit] = inferApiDescriptors([cap]);
    expect(hit!.descriptor.listPath).toBe('data.chapters');
    expect(hit!.sampleCount).toBe(2);
  });

  test('bare slug (no URL field) → urlTemplate candidate + a confirm-prefix note', () => {
    const cap = { url: EP, body: JSON.stringify([{ title: 'Ch 1', slug: 'ch-1' }]) };
    const [hit] = inferApiDescriptors([cap]);
    expect(hit!.descriptor.urlField).toBeUndefined();
    expect(hit!.descriptor.urlTemplate).toContain('{slug}');
    expect(hit!.descriptor.urlTemplate).toContain(UNCONFIRMED_PREFIX);
    expect(hit!.notes.join(' ')).toMatch(/prefix/i);
  });

  test('no-slug items prefer an `order` segment over an opaque `id` for the template', () => {
    // e.g. items carry only {id, order, title} and the reader URL keys off the sequential order.
    const cap = { url: EP, body: JSON.stringify([{ id: 9001, order: 1, title: 'Ch 1' }]) };
    const [hit] = inferApiDescriptors([cap]);
    expect(hit!.descriptor.urlTemplate).toContain('{order}');
    expect(hit!.descriptor.urlTemplate).not.toContain('{id}');
  });

  test('lock field → isFreeField + isFreeWhen (both polarities)', () => {
    const locked = inferApiDescriptors([
      { url: EP, body: JSON.stringify([{ title: 'C', url: '/r/1', locked: true }]) },
    ])[0];
    expect(locked!.descriptor.isFreeField).toBe('locked');
    expect(locked!.descriptor.isFreeWhen).toBe('falsy');

    const free = inferApiDescriptors([
      { url: EP, body: JSON.stringify([{ title: 'C', url: '/r/1', is_free: true }]) },
    ])[0];
    expect(free!.descriptor.isFreeField).toBe('is_free');
    expect(free!.descriptor.isFreeWhen).toBe('truthy');
  });

  test('non-chapter JSON (no title, or no url/slug reach) is not inferred', () => {
    expect(inferApiDescriptors([{ url: EP, body: JSON.stringify({ config: true, version: 3 }) }])).toEqual([]);
    expect(inferApiDescriptors([{ url: EP, body: JSON.stringify([{ foo: 1, bar: 2 }]) }])).toEqual([]);
  });

  test('pagination inferred from a total-pages header + page param; page stripped from endpoint', () => {
    const cap = {
      url: 'https://site.example/api/v1/chapters?category=42&page=1',
      body: JSON.stringify([{ title: 'C', url: '/r/1' }]),
      headers: { 'x-wp-totalpages': '7' },
    };
    const [hit] = inferApiDescriptors([cap]);
    expect(hit!.descriptor.pagination?.pageParam).toBe('page');
    expect(hit!.descriptor.pagination?.perPage).toBe(1); // the captured page's length
    expect(hit!.apiUrl).not.toContain('page=1'); // the loop re-adds it; keep it out of the base
    expect(hit!.apiUrl).toContain('category=42');
  });

  test('shouldCaptureResponse keeps only JSON xhr/fetch responses', () => {
    expect(shouldCaptureResponse({ resourceType: 'fetch', contentType: 'application/json' })).toBe(true);
    expect(shouldCaptureResponse({ resourceType: 'xhr', contentType: 'application/vnd.api+json; charset=utf-8' })).toBe(true);
    // a document/script/image is never a data-API response
    expect(shouldCaptureResponse({ resourceType: 'document', contentType: 'application/json' })).toBe(false);
    expect(shouldCaptureResponse({ resourceType: 'script', contentType: 'application/javascript' })).toBe(false);
    // xhr but HTML body → not JSON
    expect(shouldCaptureResponse({ resourceType: 'xhr', contentType: 'text/html' })).toBe(false);
  });

  test('multiple captures ranked by sampleCount; bad JSON skipped; never throws', () => {
    const small = { url: 'https://site.example/api/menu', body: JSON.stringify([{ title: 'Home', url: '/' }]) };
    const big = {
      url: EP,
      body: JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ title: `Ch ${i + 1}`, url: `/r/${i + 1}`, order: i + 1 }))),
    };
    const bad = { url: 'https://site.example/x', body: 'not json at all' };
    const hits = inferApiDescriptors([small, bad, big]);
    expect(hits[0]!.apiUrl).toBe(EP); // the longest list ranks first
    expect(hits.some((h) => h.apiUrl === 'https://site.example/x')).toBe(false);
  });
});
