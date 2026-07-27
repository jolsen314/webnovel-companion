import { describe, expect, test } from 'vitest';
import { diffChapters, type FeedItem, type KnownChapter } from '../../../src/lib/feeds/diff';

// Small helper so tests read as intent, not boilerplate.
function item(partial: Partial<FeedItem> & { url: string }): FeedItem {
  return { title: partial.url, ...partial };
}

describe('diffChapters', () => {
  test('first run: with nothing stored, every fetched item is new', () => {
    const fetched = [item({ url: 'https://site/ch/1' }), item({ url: 'https://site/ch/2' })];

    const result = diffChapters([], fetched);

    expect(result.new).toEqual(fetched);
  });

  test('no duplicates: an already-stored chapter is not reported new', () => {
    const ch1 = item({ url: 'https://site/ch/1' });
    const ch2 = item({ url: 'https://site/ch/2' });

    const result = diffChapters([{ url: 'https://site/ch/1' }], [ch1, ch2]);

    expect(result.new).toEqual([ch2]);
  });

  test('edit-tolerant: same guid with a changed title/url is a seen edit, not new', () => {
    const stored = [{ guid: 'g1', url: 'https://site/ch/1' }];
    const edited = item({ guid: 'g1', url: 'https://site/ch/1-fixed', title: 'Chapter 1 (revised)' });

    const result = diffChapters(stored, [edited]);

    expect(result.new).toEqual([]);
  });

  test('guards guid/url mixing: a stored-with-guid chapter matches a later guidless fetch of the same url', () => {
    const stored = [{ guid: 'g1', url: 'https://site/ch/1' }];
    const guidless = item({ url: 'https://site/ch/1' });

    expect(diffChapters(stored, [guidless]).new).toEqual([]);
  });

  test('guards guid/url mixing: a stored-by-url chapter matches a later fetch that adds a guid', () => {
    const stored = [{ url: 'https://site/ch/1' }];
    const withGuid = item({ guid: 'g1', url: 'https://site/ch/1' });

    expect(diffChapters(stored, [withGuid]).new).toEqual([]);
  });

  test('canonicalizes URLs: trailing-slash and fragment variants match a stored chapter', () => {
    const stored = [{ url: 'https://site/ch/1' }];
    const slash = item({ url: 'https://site/ch/1/' });
    const fragment = item({ url: 'https://site/ch/1#top' });

    expect(diffChapters(stored, [slash]).new).toEqual([]);
    expect(diffChapters(stored, [fragment]).new).toEqual([]);
  });

  test('canonicalizes URLs: ignores tracking params and query-string order', () => {
    const stored = [{ url: 'https://site/ch/1?a=1&b=2' }];
    const noisy = item({ url: 'https://site/ch/1?b=2&utm_source=rss&a=1&fbclid=xyz' });

    expect(diffChapters(stored, [noisy]).new).toEqual([]);
  });

  test('preserves meaningful query params: different ?chapter= values stay distinct chapters', () => {
    const stored = [{ url: 'https://site/read?chapter=1' }];
    const other = item({ url: 'https://site/read?chapter=2' });

    expect(diffChapters(stored, [other]).new).toEqual([other]);
  });

  test('no dupes within a batch: a chapter repeated in one feed appears once', () => {
    const ch1a = item({ url: 'https://site/ch/1', title: 'Chapter 1' });
    const ch1b = item({ url: 'https://site/ch/1/', title: 'Chapter 1 (dupe entry)' });

    const result = diffChapters([], [ch1a, ch1b]);

    expect(result.new).toEqual([ch1a]);
  });

  // Regression guards for properties already satisfied by identity-based diffing.

  test('reorder-tolerant: detection is independent of fetched order', () => {
    const stored = [{ url: 'https://site/ch/1' }];
    const ch2 = item({ url: 'https://site/ch/2' });
    const ch3 = item({ url: 'https://site/ch/3' });
    const ch1 = item({ url: 'https://site/ch/1' });

    // ch1 is stored; ch3/ch2 are new regardless of the shuffled input order.
    expect(diffChapters(stored, [ch3, ch1, ch2]).new).toEqual([ch3, ch2]);
  });

  test('idempotent: folding the new chapters into stored yields nothing new next run', () => {
    const fetched = [item({ url: 'https://site/ch/1' }), item({ url: 'https://site/ch/2' })];

    const firstRun = diffChapters([], fetched);
    const stored = firstRun.new.map((c) => ({ guid: c.guid, url: c.url }));

    expect(diffChapters(stored, fetched).new).toEqual([]);
  });

  test('chapter number is not part of identity: missing/decimal numbers still diff by key', () => {
    const stored = [{ url: 'https://site/ch/1' }];
    const decimal = item({ url: 'https://site/ch/1.5', number: 1.5 });
    const noNumber = item({ url: 'https://site/ch/extra', number: null });

    expect(diffChapters(stored, [decimal, noNumber]).new).toEqual([decimal, noNumber]);
  });

  test('empty fetch yields nothing new', () => {
    expect(diffChapters([{ url: 'https://site/ch/1' }], []).new).toEqual([]);
  });

  test('tolerates unparseable URLs via a string fallback', () => {
    const stored = [{ url: 'not a real url' }];
    const same = item({ url: 'not a real url' });
    const different = item({ url: 'also not a url' });

    expect(diffChapters(stored, [same]).new).toEqual([]);
    expect(diffChapters(stored, [different]).new).toEqual([different]);
  });

  test('contract: new chapters are returned in fetched order', () => {
    const c3 = item({ url: 'https://site/ch/3' });
    const c1 = item({ url: 'https://site/ch/1' });
    const c2 = item({ url: 'https://site/ch/2' });

    expect(diffChapters([], [c3, c1, c2]).new).toEqual([c3, c1, c2]);
  });

  // Split chapters: translators sometimes break one chapter into released parts.
  // Conventions vary (decimals like 12.1/12.2, or a shared title with a
  // parenthetical part number), so identity must key on url/guid — never on
  // chapter number or title — so distinct parts stay distinct.
  test('split chapters (decimals): each part is a distinct new chapter, and a stored part is not re-reported', () => {
    const p1 = item({ url: 'https://site/ch/12-1', number: 12.1, title: 'Chapter 12.1' });
    const p2 = item({ url: 'https://site/ch/12-2', number: 12.2, title: 'Chapter 12.2' });

    expect(diffChapters([], [p1, p2]).new).toEqual([p1, p2]);
    expect(diffChapters([{ url: 'https://site/ch/12-1' }], [p1, p2]).new).toEqual([p2]);
  });

  test('split chapters (parenthetical parts): same title, different urls stay distinct', () => {
    const a = item({ url: 'https://site/ch/12-part-1', title: 'Chapter 12 (Part 1)' });
    const b = item({ url: 'https://site/ch/12-part-2', title: 'Chapter 12 (Part 2)' });

    expect(diffChapters([], [a, b]).new).toEqual([a, b]);
  });
});

describe('diffChapters — becameFree (locked→free unlocks)', () => {
  const stored = (url: string, access?: 'FREE' | 'LOCKED', guid?: string): KnownChapter => ({ url, access, guid });
  const fetchedItem = (url: string, access?: 'FREE' | 'LOCKED', guid?: string): FeedItem => ({ url, title: url, access, guid });

  test('a stored LOCKED chapter now FREE is reported in becameFree (not new)', () => {
    const r = diffChapters([stored('https://x/ch-2', 'LOCKED')], [fetchedItem('https://x/ch-2', 'FREE')]);
    expect(r.new).toEqual([]);
    expect(r.becameFree.map((c) => c.url)).toEqual(['https://x/ch-2']);
  });

  test('unchanged access produces no becameFree (FREE→FREE, LOCKED→LOCKED)', () => {
    const r = diffChapters(
      [stored('https://x/a', 'FREE'), stored('https://x/b', 'LOCKED')],
      [fetchedItem('https://x/a', 'FREE'), fetchedItem('https://x/b', 'LOCKED')],
    );
    expect(r.becameFree).toEqual([]);
  });

  test('UNKNOWN (feed) stored access never counts as an unlock', () => {
    const r = diffChapters([stored('https://x/a', undefined)], [fetchedItem('https://x/a', 'FREE')]);
    expect(r.becameFree).toEqual([]);
  });

  test('a re-lock (stored FREE, fetched LOCKED) is ignored', () => {
    const r = diffChapters([stored('https://x/a', 'FREE')], [fetchedItem('https://x/a', 'LOCKED')]);
    expect(r.becameFree).toEqual([]);
  });

  test('a brand-new locked chapter lands in new, not becameFree', () => {
    const r = diffChapters([], [fetchedItem('https://x/a', 'LOCKED')]);
    expect(r.new.map((c) => c.url)).toEqual(['https://x/a']);
    expect(r.becameFree).toEqual([]);
  });

  test('stored access resolves by guid when the url differs', () => {
    const r = diffChapters(
      [stored('https://x/old', 'LOCKED', 'g1')],
      [fetchedItem('https://x/new', 'FREE', 'g1')],
    );
    expect(r.becameFree.map((c) => c.guid)).toEqual(['g1']);
  });

  test('idempotent: once stored FREE, re-diff yields no becameFree', () => {
    const r = diffChapters([stored('https://x/a', 'FREE')], [fetchedItem('https://x/a', 'FREE')]);
    expect(r.becameFree).toEqual([]);
  });
});
