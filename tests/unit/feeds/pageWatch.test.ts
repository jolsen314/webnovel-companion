import { describe, expect, test } from 'vitest';
import { parseToc, mergeFeedAndToc, tocReadingOrder } from '../../../src/lib/feeds/pageWatch';

const base = 'https://site.example/novel/x/';

describe('parseToc — generic extraction', () => {
  test('extracts chapters from a simple list: resolves URLs, parses numbers, defaults FREE', () => {
    const html = `<html><body><main><ul class="chapters">
      <li><a href="chapter-1/">Chapter 1: The Start</a></li>
      <li><a href="/novel/x/chapter-2/">Chapter 2: The Middle</a></li>
    </ul></main></body></html>`;

    expect(parseToc(html, base)).toEqual([
      { url: 'https://site.example/novel/x/chapter-1/', title: 'Chapter 1: The Start', number: 1, access: 'FREE' },
      { url: 'https://site.example/novel/x/chapter-2/', title: 'Chapter 2: The Middle', number: 2, access: 'FREE' },
    ]);
  });

  test('captures full-word "Episode" links (text and /episode-N/ href), not just the short "ep N" form', () => {
    const html = `<html><body><main><ul>
      <li><a href="/novel/x/episode-244-festival-of-the-gods-6/">Episode 244</a></li>
      <li><a href="/novel/x/episode-245-festival-of-the-gods-7/">Episode 245</a></li>
    </ul></main></body></html>`;

    expect(parseToc(html, base).map((c) => c.number)).toEqual([244, 245]);
  });

  test('ignores non-chapter links (nav, comments) and scripts', () => {
    const html = `<html><body>
      <nav><a href="/home">Home</a><a href="/genres">Genres</a></nav>
      <script>var a = "chapter 99 fake";</script>
      <main><a href="/novel/x/chapter-5/">Chapter 5</a></main>
    </body></html>`;

    const chapters = parseToc(html, base);
    expect(chapters.map((c) => c.number)).toEqual([5]);
  });

  test('marks locked chapters via lock signals (🔒, "Locked" text, or a premium/lock class)', () => {
    const html = `<ul>
      <li><a href="/novel/x/c-10/">Chapter 10</a></li>
      <li class="premium"><a href="/novel/x/c-11/">Chapter 11</a></li>
      <li><a href="/novel/x/c-12/">Chapter 12 🔒</a></li>
      <li><a href="/novel/x/c-13/">Chapter 13</a> <span class="chapter-status locked">Locked</span></li>
    </ul>`;

    const access = Object.fromEntries(parseToc(html, base).map((c) => [c.number, c.access]));
    expect(access).toEqual({ 10: 'FREE', 11: 'LOCKED', 12: 'LOCKED', 13: 'LOCKED' });
  });

  test('skips unrendered client-side template stubs (e.g. "{{chapter_slug}}")', () => {
    const html = `<ul>
      <li><a href="/novel/x/chapter-1/">Chapter 1</a></li>
      <li><a href="/novel/x/{{chapter_slug}}/">{{volume}} {{chapter}}</a></li>
    </ul>`;

    expect(parseToc(html, base).map((c) => c.number)).toEqual([1]);
  });

  test('drops unrendered dotted-expression stubs like href="chapter.permalink"', () => {
    const html = `<html><body><main><ul>
      <li><a href="chapter.permalink">Chapter</a></li>
      <li><a href="/novel/x/chapter-1/">Chapter 1</a></li>
      <li><a href="/novel/x/chapter-2/">Chapter 2</a></li>
    </ul></main></body></html>`;

    expect(parseToc(html, base).map((c) => c.url)).toEqual([
      'https://site.example/novel/x/chapter-1/',
      'https://site.example/novel/x/chapter-2/',
    ]);
  });

  test('Madara/lightnovel: dedupes the icon+link pair and uses the number from .epl-num / url', () => {
    // Two anchors to the same chapter (Madara emits an icon link + a title link with an empty-text title attr).
    const html = `<div class="eplister"><ul>
      <li><div class="eph-num">
        <a class="lnk" href="/novel/x/volume-1-chapter-7/" title="A Quiet Morning"></a>
        <a class="gp" href="/novel/x/volume-1-chapter-7/"><i class="fas fa-book"></i></a>
      </div></li>
    </ul></div>`;

    expect(parseToc(html, base)).toEqual([
      { url: 'https://site.example/novel/x/volume-1-chapter-7/', title: 'A Quiet Morning', number: 7, access: 'FREE' },
    ]);
  });
});

describe('parseToc — per-host config override', () => {
  test('uses a config chapterSelector + lockSelector when the generic scan is wrong', () => {
    const html = `<div id="list">
      <div class="row"><a href="/r/1">Story One</a></div>
      <div class="row locked-row"><a href="/r/2">Story Two</a><i class="lock"></i></div>
    </div>`;

    const chapters = parseToc(html, base, { chapterSelector: '#list .row a', lockSelector: '.lock' });
    expect(chapters.map((c) => [c.url, c.access])).toEqual([
      ['https://site.example/r/1', 'FREE'],
      ['https://site.example/r/2', 'LOCKED'],
    ]);
  });
});

describe('parseToc — content scoping (WP-36)', () => {
  const base = 'https://site.example/toc/';
  const page = (main: string, sidebar = '') =>
    `<html><body><div class="entry-content">${main}</div>` +
    `<aside class="widget-area"><div class="widget_recent_entries">${sidebar}</div></aside></body></html>`;

  test('drops chapter links inside a "recent entries" sidebar (cross-series leak)', () => {
    const html = page(
      `<a href="https://site.example/book1-chapter-1/">Chapter 1</a><a href="https://site.example/book1-chapter-2/">Chapter 2</a>`,
      `<a href="https://site.example/other-series-99/">Chapter 99</a>`,
    );
    const out = parseToc(html, base);
    expect(out.map((c) => c.url)).toEqual(['https://site.example/book1-chapter-1/', 'https://site.example/book1-chapter-2/']);
  });

  test('empty-fallback: when the ONLY chapters are inside a widget, still return them', () => {
    const html =
      `<html><body><aside class="widget-area">` +
      `<a href="https://site.example/ch-1/">Chapter 1</a></aside></body></html>`;
    expect(parseToc(html, base).map((c) => c.url)).toEqual(['https://site.example/ch-1/']);
  });

  test('contentSelector restricts the scan to a container', () => {
    const html =
      `<div class="entry-content"><a href="https://site.example/a-1/">Chapter 1</a></div>` +
      `<div class="other"><a href="https://site.example/b-2/">Chapter 2</a></div>`;
    const out = parseToc(html, base, { chapterSelector: 'a[href]', contentSelector: '.entry-content' });
    expect(out.map((c) => c.url)).toEqual(['https://site.example/a-1/']);
  });

  test('slugFamilies keeps only the series slug prefixes (multi-family Part 1/Part 2)', () => {
    const html = page(
      `<a href="https://site.example/book1-chapter-5/">c5</a>` +
        `<a href="https://site.example/book2-1/">p2c1</a>` +
        `<a href="https://site.example/rewind-3/">rewind</a>`,
    );
    const out = parseToc(html, base, { chapterSelector: 'a[href]', slugFamilies: ['book1-chapter', 'book2-'] });
    expect(out.map((c) => c.url)).toEqual(['https://site.example/book1-chapter-5/', 'https://site.example/book2-1/']);
  });
});

describe('parseToc — cross-series / recommendation exclusion (WP-57)', () => {
  const base = 'https://site.example/novel/my-series/';

  test('drops inline "you may also like" cards linking to other novels under the same collection', () => {
    // A recommendation widget sits in the content (not a sidebar), so WP-36 chrome-scoping misses it.
    // Its cards link to /novel/<other-slug> and carry "… Chapters: N" text that trips CHAPTER_TEXT.
    const html = `<html><body><main>
      <ul class="chapters">
        <li><a href="/novel/my-series/chapter-1/">Chapter 1</a></li>
        <li><a href="/novel/my-series/chapter-2/">Chapter 2</a></li>
      </ul>
      <div class="related"><h3>You may also like</h3>
        <a href="/novel/other-one/">Other One — Chapters: 1200</a>
        <a href="/novel/other-two/">Other Two — Chapters: 999</a>
      </div>
    </main></body></html>`;

    expect(parseToc(html, base).map((c) => c.url)).toEqual([
      'https://site.example/novel/my-series/chapter-1/',
      'https://site.example/novel/my-series/chapter-2/',
    ]);
  });

  test('SPA shell: when the only links are other-novel recommendation cards, returns nothing (no wrong-series ingest)', () => {
    // The render captured only the shell — the real chapter list never hydrated, so every chapter-like
    // link on the page is a recommendation card for a different novel. Better 0 chapters than 16 wrong ones.
    const html = `<html><body><main><div class="popular">
      <a href="/novel/foo/">Foo — Chapters: 1234</a>
      <a href="/novel/bar/">Bar — Chapters: 88</a>
    </div></main></body></html>`;

    expect(parseToc(html, base)).toEqual([]);
  });

  test('keeps own chapters routed under /<collection>/chapter/<id> (global-id sites) while dropping sibling landing cards', () => {
    // Some hosts route every chapter under /book/chapter/<globalId> — NOT under the series slug — with a
    // "you may also like" widget of /book/<other-slug> landing cards alongside. The own chapters (two path
    // segments deep after the collection) must survive; only the bare 1-segment sibling landings drop.
    const b = 'https://novelight.example/book/my-series';
    const html = `<html><body><main>
      <ul>
        <li><a href="/book/chapter/247684">152 chapter</a></li>
        <li><a href="/book/chapter/247683">151 chapter</a></li>
      </ul>
      <div class="related">
        <a href="/book/other-one">Other One — Chapters: 300</a>
        <a href="/book/other-two">Other Two — Chapters: 12</a>
      </div>
    </main></body></html>`;

    expect(parseToc(html, b).map((c) => new URL(c.url).pathname)).toEqual([
      '/book/chapter/247684',
      '/book/chapter/247683',
    ]);
  });

  test('no auto-scope when the base URL lacks a recognizable collection/slug shape (flat-slug host)', () => {
    // base "/toc/" carries no series identity → slug-scoping must NOT fire (would drop every chapter).
    const flatBase = 'https://site.example/toc/';
    const html = `<html><body><main><ul>
      <li><a href="https://site.example/book1-chapter-1/">Chapter 1</a></li>
      <li><a href="https://site.example/book1-chapter-2/">Chapter 2</a></li>
    </ul></main></body></html>`;

    expect(parseToc(html, flatBase).map((c) => c.url)).toEqual([
      'https://site.example/book1-chapter-1/',
      'https://site.example/book1-chapter-2/',
    ]);
  });
});

describe('mergeFeedAndToc', () => {
  const feed = (url: string, guid?: string): import('../../../src/lib/feeds/diff').FeedItem => ({ url, title: url, guid, access: undefined });
  const toc = (url: string, access: 'FREE' | 'LOCKED'): import('../../../src/lib/feeds/pageWatch').TocChapter => ({ url, title: url, number: null, access });

  test('feed items keep their guid but gain access from the matching TOC item', () => {
    const merged = mergeFeedAndToc([feed('https://x/a', 'g1')], [toc('https://x/a', 'FREE')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ url: 'https://x/a', guid: 'g1', access: 'FREE' });
  });

  test('TOC items missing from the feed (older tail) are appended with their access', () => {
    const merged = mergeFeedAndToc([feed('https://x/b', 'g2')], [toc('https://x/a', 'LOCKED'), toc('https://x/b', 'FREE')]);
    expect(merged.map((c) => c.url).sort()).toEqual(['https://x/a', 'https://x/b']);
    expect(merged.find((c) => c.url === 'https://x/a')!.access).toBe('LOCKED'); // tail, from TOC
    expect(merged.find((c) => c.url === 'https://x/b')!.guid).toBe('g2'); // overlap keeps feed guid
  });

  test('canonical match ignores tracking params / trailing slash', () => {
    const merged = mergeFeedAndToc([feed('https://x/a?utm_source=rss', 'g1')], [toc('https://x/a/', 'LOCKED')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ guid: 'g1', access: 'LOCKED' });
  });

  test('empty TOC (under-read) → just the feed items, unchanged', () => {
    const merged = mergeFeedAndToc([feed('https://x/a', 'g1')], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.access).toBeUndefined();
  });

  test('two TOC rows that canonicalize equal are merged once (no double-insert)', () => {
    const merged = mergeFeedAndToc([], [toc('https://x/ch/1', 'FREE'), toc('https://x/ch/1/', 'FREE')]);
    expect(merged).toHaveLength(1);
  });
});

describe('tocReadingOrder', () => {
  const c = (url: string, number: number | null) => ({ url, number });

  test('ascending TOC (ch1,ch2,ch3 in DOM order) → positions 0,1,2', () => {
    const m = tocReadingOrder([c('https://x/1', 1), c('https://x/2', 2), c('https://x/3', 3)]);
    expect(m).not.toBeNull();
    expect(m!.get('https://x/1')).toBe(0);
    expect(m!.get('https://x/3')).toBe(2);
  });

  test('descending TOC (newest-first) is normalized so the oldest gets position 0', () => {
    const m = tocReadingOrder([c('https://x/3', 3), c('https://x/2', 2), c('https://x/1', 1)]);
    expect(m!.get('https://x/1')).toBe(0);
    expect(m!.get('https://x/3')).toBe(2);
  });

  test('canonical-URL keys (tracking/slash ignored)', () => {
    const m = tocReadingOrder([c('https://x/1/?utm_source=rss', 1), c('https://x/2', 2), c('https://x/3', 3)]);
    expect(m!.get('https://x/1')).toBe(0);
  });

  test('too few numbered chapters → null (skip positioning)', () => {
    expect(tocReadingOrder([c('https://x/a', null), c('https://x/b', 1)])).toBeNull();
  });

  test('ambiguous number trend → null', () => {
    const m = tocReadingOrder([c('https://x/a', 1), c('https://x/b', 5), c('https://x/c', 2), c('https://x/d', 4), c('https://x/e', 3)]);
    expect(m).toBeNull();
  });
});
