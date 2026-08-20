import { describe, expect, test } from 'vitest';
import { pageUrl, itemsAt, isLastPage } from '../../../src/lib/feeds/apiPaginate';

describe('pageUrl', () => {
  test('sets the page param, preserving existing query params', () => {
    expect(pageUrl('https://api.example/ch?category=7&order=asc&per_page=200', 'page', 3))
      .toBe('https://api.example/ch?category=7&order=asc&per_page=200&page=3');
  });
  test('replaces an existing page param', () => {
    expect(pageUrl('https://api.example/ch?page=1', 'page', 2)).toBe('https://api.example/ch?page=2');
  });
});

describe('itemsAt', () => {
  test('root array when no listPath', () => {
    expect(itemsAt([{ a: 1 }], undefined)).toEqual([{ a: 1 }]);
  });
  test('nested listPath', () => {
    expect(itemsAt({ data: { chapters: [{ a: 1 }] } }, 'data.chapters')).toEqual([{ a: 1 }]);
  });
  test('drift → []', () => {
    expect(itemsAt({ nope: 1 }, 'data.chapters')).toEqual([]);
    expect(itemsAt(42, undefined)).toEqual([]);
  });
  test('an inherited (prototype) key is not walked', () => {
    // A key present only on the prototype chain (not an own property) must resolve to []
    // rather than being read via prototype access — Object.hasOwn guards the walk.
    const proto = { chapters: [{ a: 1 }] };
    const node = Object.create(proto) as Record<string, unknown>;
    expect(itemsAt(node, 'chapters')).toEqual([]);
  });
});

describe('isLastPage', () => {
  test('short page is the last', () => {
    expect(isLastPage(18, 200)).toBe(true);
    expect(isLastPage(200, 200)).toBe(false);
    expect(isLastPage(0, 200)).toBe(true);
  });
});
