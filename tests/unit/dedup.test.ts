import { describe, expect, test } from 'vitest';
import { canonicalSeriesId, findSimilarTitle } from '../../src/lib/dedup';

const page = (sourceUrl: string) => canonicalSeriesId({ feedUrl: null, sourceUrl, match: { type: 'WHOLE_FEED' } });

describe('canonicalSeriesId', () => {
  test('feed WHOLE_FEED keys on the feed, scheme/www/slash/tracking-insensitive', () => {
    const a = canonicalSeriesId({ feedUrl: 'https://www.site.example/feed/', sourceUrl: 'https://site.example/', match: { type: 'WHOLE_FEED' } });
    const b = canonicalSeriesId({ feedUrl: 'http://site.example/feed?utm_source=x', sourceUrl: 'https://site.example/other', match: { type: 'WHOLE_FEED' } });
    expect(a).toBe('site.example/feed#WHOLE_FEED');
    expect(b).toBe(a);
  });

  test('home vs TOC URL resolving to the same feed+match → same id', () => {
    const home = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/', match: { type: 'WHOLE_FEED' } });
    const toc = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/toc/', match: { type: 'WHOLE_FEED' } });
    expect(home).toBe(toc);
  });

  test('two novels on one site feed (different CATEGORY) → different ids', () => {
    const a = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/a', match: { type: 'CATEGORY', value: 'Alpha' } });
    const b = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/b', match: { type: 'CATEGORY', value: 'Beta' } });
    expect(a).toBe('site.example/feed#CATEGORY:alpha'); // CATEGORY value is slugified
    expect(a).not.toBe(b);
  });

  test('CATEGORY name (positive match) and its URL slug (fallback match) converge to one id (WP-39 hardening)', () => {
    // chooseSeriesMatch returns the raw category name; fallbackSeriesMatch returns the URL slug.
    // Slugifying the CATEGORY value makes a re-add via either path compute the SAME id.
    const positive = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/silver-moon-saga/', match: { type: 'CATEGORY', value: 'Silver Moon Saga' } });
    const fallback = canonicalSeriesId({ feedUrl: 'https://site.example/feed/', sourceUrl: 'https://site.example/silver-moon-saga/', match: { type: 'CATEGORY', value: 'silver-moon-saga' } });
    expect(positive).toBe('site.example/feed#CATEGORY:silver-moon-saga');
    expect(fallback).toBe(positive);
  });

  test('PATH_PREFIX discriminates too', () => {
    expect(canonicalSeriesId({ feedUrl: 'https://s.example/feed/', sourceUrl: 'x', match: { type: 'PATH_PREFIX', value: '/alpha' } }))
      .toBe('s.example/feed#PATH_PREFIX:/alpha');
  });

  test('page-watch keys on the normalized source URL (scheme/www/slash-insensitive)', () => {
    expect(page('https://www.site.example/novel/x/')).toBe('site.example/novel/x');
  });

  test('two different page-watch pages → different ids (the home-vs-TOC residual, not deduped here)', () => {
    expect(page('https://site.example/')).not.toBe(page('https://site.example/toc/'));
  });

  test('WP-39b: page-watch keys on tocUrl — home-add and TOC-add sharing a TOC collapse to one id', () => {
    const home = canonicalSeriesId({ feedUrl: null, tocUrl: 'https://s.example/toc/', sourceUrl: 'https://s.example/', match: { type: 'WHOLE_FEED' } });
    const tocAdd = canonicalSeriesId({ feedUrl: null, tocUrl: null, sourceUrl: 'https://s.example/toc/', match: { type: 'WHOLE_FEED' } });
    expect(home).toBe('s.example/toc');
    expect(home).toBe(tocAdd);
  });

  test('WP-39b: two page-watch series with different TOCs stay distinct', () => {
    const a = canonicalSeriesId({ feedUrl: null, tocUrl: 'https://s.example/a/toc/', sourceUrl: 'https://s.example/a/', match: { type: 'WHOLE_FEED' } });
    const b = canonicalSeriesId({ feedUrl: null, tocUrl: 'https://s.example/b/toc/', sourceUrl: 'https://s.example/b/', match: { type: 'WHOLE_FEED' } });
    expect(a).not.toBe(b);
  });

  test('WP-39b: page-watch with no tocUrl still keys on sourceUrl (unchanged)', () => {
    const id = canonicalSeriesId({ feedUrl: null, sourceUrl: 'https://s.example/x/', match: { type: 'WHOLE_FEED' } });
    expect(id).toBe('s.example/x');
  });
});

describe('findSimilarTitle', () => {
  const existing = [
    { id: 's1', title: 'Silver Moon Saga' },
    { id: 's2', title: 'Golden Sun Chronicle' },
  ];

  test('matches an added leading article (normalized equality)', () => {
    expect(findSimilarTitle('The Silver Moon Saga', existing)).toEqual({ id: 's1', title: 'Silver Moon Saga' });
  });

  test('matches an added subtitle (token prefix)', () => {
    expect(findSimilarTitle('Silver Moon Saga: Volume 2', existing)).toEqual({ id: 's1', title: 'Silver Moon Saga' });
  });

  test('is punctuation/whitespace/case insensitive', () => {
    expect(findSimilarTitle('  silver-moon   saga ', existing)).toEqual({ id: 's1', title: 'Silver Moon Saga' });
  });

  test('returns null for a genuinely different title', () => {
    expect(findSimilarTitle('Crimson Lotus Chronicle', existing)).toBeNull();
  });

  test('returns null for a different TRANSLATION of the same work (documented limit — no fuzzy)', () => {
    // Same underlying work, different English rendering → no shared tokens → correctly not matched here.
    expect(findSimilarTitle('The Blooddark Saint', [{ id: 'x', title: 'Crimson Lotus Chronicle' }])).toBeNull();
  });

  test('returns null when the existing list is empty', () => {
    expect(findSimilarTitle('Silver Moon Saga', [])).toBeNull();
  });
});
