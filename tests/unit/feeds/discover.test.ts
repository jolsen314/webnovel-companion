import { describe, expect, test } from 'vitest';
import {
  discoverFeeds,
  guessFeedUrls,
  chooseSeriesMatch,
  fallbackSeriesMatch,
  filterBySeriesMatch,
} from '../../../src/lib/feeds/discover';
import type { FeedItem } from '../../../src/lib/feeds/diff';

// Anonymized fixtures (reserved .example domains, generic works). The structural
// shapes mirror the three real archetypes from the 2026-07-16 spike:
//   - a single-novel per-series feed (no competing categories),
//   - a multi-novel WordPress feed where a per-novel <category> matches the series slug,
//   - a multi-novel feed where nothing matches, so we fall back to the URL path.
function item(url: string, categories: string[] = []): FeedItem {
  return { url, title: url, categories };
}

describe('discoverFeeds', () => {
  test('finds rss/atom alternate links, resolves relative URLs, ignores non-feed links', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="Series Feed" href="https://site.example/series/x/feed" />
      <link rel="alternate" type="application/rss+xml" title="Comments" href="/comments/feed/" />
      <link rel="stylesheet" href="/style.css">
      <link rel="alternate" hreflang="es" href="/es/">
      <link rel="alternate" type="application/atom+xml" href="/atom.xml">
    </head><body></body></html>`;

    const feeds = discoverFeeds(html, 'https://site.example/series/x/');

    expect(feeds).toEqual([
      { url: 'https://site.example/series/x/feed', type: 'rss', title: 'Series Feed' },
      { url: 'https://site.example/comments/feed/', type: 'rss', title: 'Comments' },
      { url: 'https://site.example/atom.xml', type: 'atom', title: null },
    ]);
  });

  test('returns empty when there are no feed links', () => {
    expect(discoverFeeds('<html><head></head></html>', 'https://site.example/')).toEqual([]);
  });
});

describe('guessFeedUrls', () => {
  test('offers WordPress-style fallbacks: page feed and site-root feed', () => {
    const guesses = guessFeedUrls('https://site.example/novel/example-novel/');
    expect(guesses).toContain('https://site.example/novel/example-novel/feed/');
    expect(guesses).toContain('https://site.example/feed/');
  });
});

describe('chooseSeriesMatch', () => {
  test('single-novel feed (no distinct novel categories) → WHOLE_FEED (per-series feed)', () => {
    const items = [
      item('https://reader.example/series/alpha/chapter-79'),
      item('https://reader.example/series/alpha/chapter-78'),
    ];

    expect(chooseSeriesMatch(items, 'https://reader.example/series/alpha')).toEqual({ type: 'WHOLE_FEED' });
  });

  test('multi-novel feed where a category matches the series slug → CATEGORY', () => {
    const items = [
      item('https://translator.example/sms-407/', ['Silver Moon Saga']),
      item('https://translator.example/ot-12/', ['Other Tale']),
      item('https://translator.example/ts-3/', ['Third Story']),
    ];

    expect(chooseSeriesMatch(items, 'https://translator.example/silver-moon-saga/')).toEqual({
      type: 'CATEGORY',
      value: 'Silver Moon Saga',
    });
  });

  test('some items under the series path (mixed feed) → PATH_PREFIX', () => {
    const items = [
      item('https://reader.example/series/zeta/zeta-5/', ['Zeta Chronicles']), // this series (category doesn't slug-match)
      item('https://reader.example/series/other/other-9/', ['Other']), // a different one
    ];

    expect(chooseSeriesMatch(items, 'https://reader.example/series/zeta/')).toEqual({
      type: 'PATH_PREFIX',
      value: '/series/zeta/',
    });
  });

  test('series not identifiable in the current window (no category or path tie) → null', () => {
    const items = [
      item('https://reader.example/first-90/', ['First Novel']),
      item('https://reader.example/second-439/', ['Second Novel']),
    ];

    expect(chooseSeriesMatch(items, 'https://reader.example/novel/zeta/')).toBeNull();
  });
});

describe('fallbackSeriesMatch (series-scoped guess when not in the window)', () => {
  test('categorized feed → CATEGORY keyed by the series slug (fills in when it next publishes)', () => {
    const items = [item('https://x.example/other-1/', ['Some Other Novel'])];
    expect(fallbackSeriesMatch(items, 'https://x.example/novel/silver-moon/')).toEqual({
      type: 'CATEGORY',
      value: 'silver-moon',
    });
  });

  test('uncategorized feed → PATH_PREFIX from the series URL', () => {
    const items = [item('https://x.example/other-1/')];
    expect(fallbackSeriesMatch(items, 'https://x.example/series/zeta/')).toEqual({
      type: 'PATH_PREFIX',
      value: '/series/zeta/',
    });
  });
});

describe('filterBySeriesMatch', () => {
  const a = item('https://translator.example/sms-407/', ['Silver Moon Saga']);
  const b = item('https://translator.example/ot-12/', ['Other Tale']);
  const c = item('https://reader.example/series/zeta/zeta-5/');
  const items = [a, b, c];

  test('WHOLE_FEED keeps everything', () => {
    expect(filterBySeriesMatch(items, { type: 'WHOLE_FEED' })).toEqual(items);
  });

  test('CATEGORY keeps only items carrying that category', () => {
    expect(filterBySeriesMatch(items, { type: 'CATEGORY', value: 'Silver Moon Saga' })).toEqual([a]);
  });

  test('CATEGORY also matches by slug (for the slug-keyed fallback)', () => {
    const d = item('https://x.example/tw-1/', ['The Recurring Villain']);
    expect(filterBySeriesMatch([d], { type: 'CATEGORY', value: 'the-recurring-villain' })).toEqual([d]);
  });

  test('PATH_PREFIX keeps only items whose url path starts with the prefix', () => {
    expect(filterBySeriesMatch(items, { type: 'PATH_PREFIX', value: '/series/zeta/' })).toEqual([c]);
  });
});
