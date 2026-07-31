import { describe, expect, test } from 'vitest';
import { canonicalSeriesId } from '../../src/lib/dedup';

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
    expect(a).toBe('site.example/feed#CATEGORY:Alpha');
    expect(a).not.toBe(b);
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
});
