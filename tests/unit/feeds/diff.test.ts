import { describe, expect, test } from 'vitest';
import { diffChapters, type FeedItem } from '../../../src/lib/feeds/diff';

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

  test('canonicalizes URLs: trailing-slash and fragment variants match a stored chapter', () => {
    const stored = [{ url: 'https://site/ch/1' }];
    const slash = item({ url: 'https://site/ch/1/' });
    const fragment = item({ url: 'https://site/ch/1#top' });

    expect(diffChapters(stored, [slash]).new).toEqual([]);
    expect(diffChapters(stored, [fragment]).new).toEqual([]);
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
});
