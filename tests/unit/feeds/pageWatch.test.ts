import { describe, expect, test } from 'vitest';
import { parseToc } from '../../../src/lib/feeds/pageWatch';

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
