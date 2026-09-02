import { describe, expect, test } from 'vitest';
import { parseApiChapters, type ApiDescriptor } from '../../../src/lib/feeds/apiAdapter';

const BASE = 'https://api.example/works/1/chapters';

describe('parseApiChapters', () => {
  const map: ApiDescriptor = {
    listPath: 'data.chapters',
    urlField: 'link',
    numberField: 'num',
    titleField: 'title',
    isFreeField: 'free',
  };

  test('nested listPath → chapters with access from isFree', () => {
    const body = JSON.stringify({
      data: {
        chapters: [
          { num: 1, title: 'Ch 1: Start', link: 'https://api.example/read/1', free: true },
          { num: 2, title: 'Ch 2: Next', link: 'https://api.example/read/2', free: false },
        ],
      },
    });
    expect(parseApiChapters(body, map, BASE)).toEqual([
      { url: 'https://api.example/read/1', title: 'Ch 1: Start', number: 1, access: 'FREE' },
      { url: 'https://api.example/read/2', title: 'Ch 2: Next', number: 2, access: 'LOCKED' },
    ]);
  });

  test('root array + no isFreeField → all FREE', () => {
    const body = JSON.stringify([{ title: 'Ch 5: X', link: '/read/5' }]);
    const rootMap: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    expect(parseApiChapters(body, rootMap, BASE)).toEqual([
      { url: 'https://api.example/read/5', title: 'Ch 5: X', number: 5, access: 'FREE' },
    ]);
  });

  test("isFreeWhen 'falsy' inverts a `locked` field", () => {
    const body = JSON.stringify([{ n: 3, t: 'Ch 3', u: '/r/3', locked: true }]);
    const lockedMap: ApiDescriptor = {
      urlField: 'u', numberField: 'n', titleField: 't', isFreeField: 'locked', isFreeWhen: 'falsy',
    };
    expect(parseApiChapters(body, lockedMap, BASE)[0]!.access).toBe('LOCKED');
  });

  test('number falls back to the title, then tolerates decimals and missing numbers', () => {
    const body = JSON.stringify([
      { title: 'Chapter 12.5: Interlude', link: '/r/a' },
      { title: 'Prologue', link: '/r/b' },
    ]);
    const m: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    const out = parseApiChapters(body, m, BASE);
    expect(out[0]!.number).toBe(12.5);
    expect(out[1]!.number).toBeNull();
  });

  test('relative urlField resolved absolute against the endpoint origin', () => {
    const body = JSON.stringify([{ title: 'Ch 1', link: '/read/rel' }]);
    const m: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    expect(parseApiChapters(body, m, BASE)[0]!.url).toBe('https://api.example/read/rel');
  });

  test('shape drift (missing listPath / non-array / bad JSON) → [] and never throws', () => {
    const m: ApiDescriptor = { listPath: 'nope.here', urlField: 'link', titleField: 'title' };
    expect(parseApiChapters('{}', m, BASE)).toEqual([]);
    expect(parseApiChapters('not json', m, BASE)).toEqual([]);
    expect(parseApiChapters(JSON.stringify({ nope: { here: 42 } }), m, BASE)).toEqual([]);
  });

  test('items missing the url field are skipped', () => {
    const body = JSON.stringify([{ title: 'Ch 1' }, { title: 'Ch 2', link: '/r/2' }]);
    const m: ApiDescriptor = { urlField: 'link', titleField: 'title' };
    expect(parseApiChapters(body, m, BASE).map((c) => c.url)).toEqual(['https://api.example/r/2']);
  });

  // WP-54: urlTemplate — build the reader URL from a per-item slug and/or a baked series
  // constant when the API carries only a bare slug/id (no full permalink field).
  describe('urlTemplate (bare-slug reader URLs)', () => {
    test('per-item {slug} placeholder resolves from the item', () => {
      const body = JSON.stringify([
        { slug: 'the-beginning', title: 'Ch 1', order: 1 },
        { slug: 'the-next-one', title: 'Ch 2', order: 2 },
      ]);
      const m: ApiDescriptor = {
        urlTemplate: '/novel/{slug}',
        numberField: 'order',
        titleField: 'title',
      };
      expect(parseApiChapters(body, m, BASE).map((c) => c.url)).toEqual([
        'https://api.example/novel/the-beginning',
        'https://api.example/novel/the-next-one',
      ]);
    });

    test('literal series slug + per-item {order} placeholder', () => {
      // Items carry only {order, title}; the series slug lives in the API query, so it is
      // baked into the template as a literal path segment (descriptor is per-source).
      const body = JSON.stringify([
        { order: 1, title: 'Ch 1' },
        { order: 2, title: 'Ch 2' },
      ]);
      const m: ApiDescriptor = {
        urlTemplate: '/novel/my-series/{order}',
        numberField: 'order',
        titleField: 'title',
      };
      expect(parseApiChapters(body, m, BASE).map((c) => c.url)).toEqual([
        'https://api.example/novel/my-series/1',
        'https://api.example/novel/my-series/2',
      ]);
    });

    test('urlTemplate takes precedence over urlField when both are set', () => {
      const body = JSON.stringify([{ slug: 'from-template', link: '/from-field/9', title: 'Ch 9' }]);
      const m: ApiDescriptor = {
        urlTemplate: '/novel/{slug}',
        urlField: 'link',
        titleField: 'title',
      };
      expect(parseApiChapters(body, m, BASE)[0]!.url).toBe('https://api.example/novel/from-template');
    });

    test('an item whose template placeholder is missing/empty is skipped', () => {
      const body = JSON.stringify([
        { title: 'Ch 1' }, // no slug → cannot build URL
        { slug: '', title: 'Ch 2' }, // empty slug → cannot build URL
        { slug: 'ok', title: 'Ch 3' },
      ]);
      const m: ApiDescriptor = { urlTemplate: '/novel/{slug}', titleField: 'title' };
      expect(parseApiChapters(body, m, BASE).map((c) => c.url)).toEqual([
        'https://api.example/novel/ok',
      ]);
    });

    test('a numeric placeholder value is stringified', () => {
      const body = JSON.stringify([{ id: 42, title: 'Ch 1' }]);
      const m: ApiDescriptor = { urlTemplate: '/read/{id}', titleField: 'title' };
      expect(parseApiChapters(body, m, BASE)[0]!.url).toBe('https://api.example/read/42');
    });
  });
});
