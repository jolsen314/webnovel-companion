import { describe, expect, test } from 'vitest';
import { addSeries, type AddSeriesPorts, type ResolvedSource } from '../../../src/server/services/addSeries';
import type { PoliteResult } from '../../../src/lib/feeds/fetch';

const PAGE = (feedHref: string) =>
  `<html><head><link rel="alternate" type="application/rss+xml" href="${feedHref}"></head><body>Novel</body></html>`;
const RSS = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha</title>${items}</channel></rss>`;
const ITEM = (guid: string, url: string, category?: string) =>
  `<item><title>${guid}</title><link>${url}</link><guid>${guid}</guid>${category ? `<category><![CDATA[${category}]]></category>` : ''}</item>`;

const ok = (body: string): PoliteResult => ({
  outcome: 'SUCCESS',
  status: 200,
  notModified: false,
  body,
  etag: null,
  lastModified: null,
  finalUrl: 'https://x.example/',
});

function ports(
  map: Record<string, PoliteResult>,
  existing: (canonicalId: string) => { seriesId: string } | null = () => null,
  render?: Record<string, PoliteResult>,
): AddSeriesPorts & { created: ResolvedSource[]; renderCalls: string[]; fetchCalls: string[] } {
  const created: ResolvedSource[] = [];
  const renderCalls: string[] = [];
  const fetchCalls: string[] = [];
  const base = {
    created,
    renderCalls,
    fetchCalls,
    fetch: async (url: string) => {
      fetchCalls.push(url);
      return map[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);
    },
    findSeriesByCanonicalId: async (canonicalId: string) => existing(canonicalId),
    listExistingSeries: async () => [],
    createSeries: async (resolved: ResolvedSource) => {
      created.push(resolved);
      return { seriesId: 'new1' };
    },
  };
  if (!render) return base;
  return {
    ...base,
    render: async (url: string) => {
      renderCalls.push(url);
      return render[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);
    },
  };
}

describe('addSeries', () => {
  test('a normally-resolved source carries fetchMode PLAIN', async () => {
    const url = 'https://translator.example/novel/alpha/';
    const feedUrl = 'https://translator.example/feed/';
    const p = ports({
      [url]: ok(PAGE(feedUrl)),
      [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/alpha-1/'))),
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.fetchMode).toBe('PLAIN');
  });

  test('page advertises a feed → resolves a FEED source with its chapters', async () => {
    const url = 'https://translator.example/novel/alpha/';
    const feedUrl = 'https://translator.example/feed/';
    const p = ports({
      [url]: ok(PAGE(feedUrl)),
      [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/alpha-1/') + ITEM('g2', 'https://translator.example/alpha-2/'))),
    });

    const result = await addSeries({ url }, p);

    expect(result.seriesId).toBe('new1');
    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.feedUrl).toBe(feedUrl);
    expect(result.resolved.host).toBe('translator.example');
    expect(result.resolved.match).toEqual({ type: 'WHOLE_FEED' });
    expect(result.resolved.chapters.map((c) => c.guid)).toEqual(['g1', 'g2']);
    expect(p.created).toHaveLength(1);
  });

  test('multi-novel feed → CATEGORY match, chapters filtered to this series', async () => {
    const url = 'https://translator.example/novel/silver-moon-saga/';
    const feedUrl = 'https://translator.example/feed/';
    const p = ports({
      [url]: ok(PAGE(feedUrl)),
      [feedUrl]: ok(
        RSS(
          ITEM('g1', 'https://translator.example/sms-1/', 'Silver Moon Saga') +
            ITEM('g2', 'https://translator.example/ot-9/', 'Other Tale'),
        ),
      ),
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.match).toEqual({ type: 'CATEGORY', value: 'Silver Moon Saga' });
    expect(result.resolved.chapters.map((c) => c.guid)).toEqual(['g1']);
  });

  test('no advertised feed but a guessed feed we can isolate (by category) works → FEED', async () => {
    const url = 'https://translator.example/novel/beta/';
    const p = ports({
      [url]: ok('<html><head></head><body>Novel</body></html>'), // no <link alternate>
      'https://translator.example/feed/': ok(RSS(ITEM('g1', 'https://translator.example/beta-1/', 'Beta'))),
      // the page-level guess (…/novel/beta/feed/) is left to default 404
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.feedUrl).toBe('https://translator.example/feed/');
    expect(result.resolved.match).toEqual({ type: 'CATEGORY', value: 'Beta' });
  });

  test('no feed anywhere → PAGE_WATCH source with no chapters yet (WP-17)', async () => {
    const url = 'https://reader.example/series/gamma/';
    const p = ports({ [url]: ok('<html><head></head><body>Novel</body></html>') }); // all feed guesses 404

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('PAGE_WATCH');
    expect(result.resolved.feedUrl).toBeNull();
    expect(result.resolved.chapters).toEqual([]);
  });

  test('no feed but the page is a TOC → PAGE_WATCH seeded from the TOC (so the first poll does not storm)', async () => {
    const url = 'https://reader.example/series/delta/';
    const toc = `<html><body><ul>
      <li><a href="https://reader.example/series/delta/chapter-1/">Chapter 1</a></li>
      <li class="premium"><a href="https://reader.example/series/delta/chapter-2/">Chapter 2</a></li>
    </ul></body></html>`;
    const p = ports({ [url]: ok(toc) }); // all feed guesses 404

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('PAGE_WATCH');
    expect(result.resolved.feedUrl).toBeNull();
    expect(result.resolved.chapters.map((c) => c.url)).toEqual([
      'https://reader.example/series/delta/chapter-1/',
      'https://reader.example/series/delta/chapter-2/',
    ]);
    expect(result.resolved.chapters.map((c) => c.access)).toEqual(['FREE', 'LOCKED']);
  });

  test('page blocked (Cloudflare 4xx) but a guessed feed we can isolate → resolves a FEED source', async () => {
    const url = 'https://blocked.example/novel/x/';
    const p = ports({
      [url]: { outcome: 'HTTP_4XX', status: 403 }, // Cloudflare challenges the page
      'https://blocked.example/feed/': ok(RSS(ITEM('g1', 'https://blocked.example/x-1/', 'X'))), // ...but /feed/ serves + we can isolate by category
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.feedUrl).toBe('https://blocked.example/feed/');
    expect(result.resolved.chapters).toHaveLength(1);
  });

  test('guessed site-wide feed, series not in the window → adds empty with a series-scoped filter (fills in later)', async () => {
    const url = 'https://blocked.example/novel/not-in-window/';
    const p = ports({
      [url]: { outcome: 'HTTP_4XX', status: 403 },
      // /feed/ serves, but only a different novel is in the current window.
      'https://blocked.example/feed/': ok(RSS(ITEM('g1', 'https://blocked.example/other-1/', 'Some Other Novel'))),
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.chapters).toHaveLength(0); // nothing to show yet…
    expect(result.resolved.match).toEqual({ type: 'CATEGORY', value: 'not-in-window' }); // …but this fills when it publishes
  });

  test('neither the page nor any feed is reachable → throws', async () => {
    const url = 'https://dead.example/novel/x/';
    const p = ports({ [url]: { outcome: 'DNS' } }); // page dead, all feed guesses 404 by default

    await expect(addSeries({ url }, p)).rejects.toThrow(/reach|feed/i);
  });

  test('hard-fail: page + feeds blocked, but render recovers the TOC → PAGE_WATCH, fetchMode RENDER', async () => {
    const url = 'https://cf.example/series/omega/';
    const rendered = `<html><body><h1>Omega</h1><ul>
      <li><a href="https://cf.example/series/omega/chapter-1/">Chapter 1</a></li>
      <li><a href="https://cf.example/series/omega/chapter-2/">Chapter 2</a></li>
    </ul></body></html>`;
    const p = ports(
      { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }, // page CF-blocked; feeds 404 by default
      () => null,
      { [url]: ok(rendered) }, // our render clears the challenge
    );

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('PAGE_WATCH');
    expect(result.resolved.fetchMode).toBe('RENDER');
    expect(result.resolved.seriesTitle).toBe('Omega'); // from the rendered <h1>
    expect(result.resolved.chapters.map((c) => c.url)).toEqual([
      'https://cf.example/series/omega/chapter-1/',
      'https://cf.example/series/omega/chapter-2/',
    ]);
    expect(p.renderCalls).toEqual([url]);
  });

  test('hard-fail: the render pass does not re-fetch the URL-derived feed guesses the plain pass already tried', async () => {
    const url = 'https://cf.example/series/omega/';
    const rendered = `<html><body><h1>Omega</h1><ul>
      <li><a href="https://cf.example/series/omega/chapter-1/">Chapter 1</a></li>
    </ul></body></html>`;
    const p = ports(
      { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }, // page + all feed guesses fail
      () => null,
      { [url]: ok(rendered) }, // render recovers a feedless TOC → PAGE_WATCH
    );

    await addSeries({ url }, p);

    // guessFeedUrls(url) is a pure function of the URL, so the render pass's guesses are identical
    // to the plain pass's already-failed ones. No URL should be fetched twice.
    expect(new Set(p.fetchCalls).size).toBe(p.fetchCalls.length);
  });

  test('hard-fail: render reveals a non-guessable advertised feed → FEED source, fetchMode PLAIN', async () => {
    const url = 'https://cf.example/novel/psi/';
    const feedUrl = 'https://cf.example/custom-feed.xml'; // not one guessFeedUrls would produce
    const p = ports(
      {
        [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult,
        [feedUrl]: ok(RSS(ITEM('g1', 'https://cf.example/psi-1/', 'Psi'))),
      },
      () => null,
      { [url]: ok(PAGE(feedUrl)) }, // rendered body advertises the feed
    );

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.feedUrl).toBe(feedUrl);
    expect(result.resolved.fetchMode).toBe('PLAIN'); // the feed serves plainly
  });

  test('hard-fail: render also fails → throws', async () => {
    const url = 'https://cf.example/novel/void/';
    const p = ports(
      { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult },
      () => null,
      { [url]: { outcome: 'HTTP_4XX', status: 403 } as PoliteResult }, // render blocked too
    );

    await expect(addSeries({ url }, p)).rejects.toThrow(/render attempt/i);
  });

  test('under-fetch: plain TOC ≤5 and render yields more → adopt rendered chapters, fetchMode RENDER', async () => {
    const url = 'https://reader.example/series/rho/';
    const plainToc = `<html><body><ul>
      <li><a href="https://reader.example/series/rho/chapter-1/">Chapter 1</a></li>
    </ul></body></html>`;
    const renderedToc = `<html><body><ul>${Array.from(
      { length: 8 },
      (_, i) => `<li><a href="https://reader.example/series/rho/chapter-${i + 1}/">Chapter ${i + 1}</a></li>`,
    ).join('')}</ul></body></html>`;
    const p = ports({ [url]: ok(plainToc) }, () => null, { [url]: ok(renderedToc) });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('PAGE_WATCH');
    expect(result.resolved.fetchMode).toBe('RENDER');
    expect(result.resolved.chapters).toHaveLength(8);
    expect(p.renderCalls).toEqual([url]); // no tocUrl on the page → renders url
  });

  test('under-fetch: plain TOC ≤5 and render yields no more → keep plain, fetchMode PLAIN', async () => {
    const url = 'https://reader.example/series/sigma/';
    const plainToc = `<html><body><ul>
      <li><a href="https://reader.example/series/sigma/chapter-1/">Chapter 1</a></li>
      <li><a href="https://reader.example/series/sigma/chapter-2/">Chapter 2</a></li>
    </ul></body></html>`;
    const renderedToc = `<html><body><ul>
      <li><a href="https://reader.example/series/sigma/chapter-1/">Chapter 1</a></li>
    </ul></body></html>`; // fewer — render didn't help
    const p = ports({ [url]: ok(plainToc) }, () => null, { [url]: ok(renderedToc) });

    const result = await addSeries({ url }, p);

    expect(result.resolved.fetchMode).toBe('PLAIN');
    expect(result.resolved.chapters).toHaveLength(2);
    expect(p.renderCalls).toEqual([url]); // we tried, but kept plain
  });

  test('rich plain TOC (>5) → no render call, fetchMode PLAIN', async () => {
    const url = 'https://reader.example/series/tau/';
    const richToc = `<html><body><ul>${Array.from(
      { length: 7 },
      (_, i) => `<li><a href="https://reader.example/series/tau/chapter-${i + 1}/">Chapter ${i + 1}</a></li>`,
    ).join('')}</ul></body></html>`;
    const p = ports({ [url]: ok(richToc) }, () => null, { [url]: ok('<ul></ul>') });

    const result = await addSeries({ url }, p);

    expect(result.resolved.fetchMode).toBe('PLAIN');
    expect(result.resolved.chapters).toHaveLength(7);
    expect(p.renderCalls).toEqual([]); // never rendered — plain was already rich
  });

  test('FEED branch never render-escalates, even when it seeds few chapters', async () => {
    const url = 'https://translator.example/novel/upsilon/';
    const feedUrl = 'https://translator.example/feed/';
    const p = ports(
      { [url]: ok(PAGE(feedUrl)), [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/ups-1/'))) },
      () => null,
      { [url]: ok('<ul></ul>') },
    );

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.fetchMode).toBe('PLAIN');
    expect(p.renderCalls).toEqual([]); // feed is the source of truth; no render
  });

  // A page that BOTH advertises a feed and is itself a chapter list (a TOC post).
  const pageWithToc = (feedHref: string, chapterUrls: string[]) =>
    `<html><head><link rel="alternate" type="application/rss+xml" href="${feedHref}"></head><body><ul>${chapterUrls
      .map((u, i) => `<li><a href="${u}">Chapter ${i + 1}</a></li>`)
      .join('')}</ul></body></html>`;

  test('WP-49: advertised multi-novel feed we cannot isolate + a real page TOC → PAGE_WATCH, not WHOLE_FEED', async () => {
    const url = 'https://wp.example/novel-toc/';
    const feedUrl = 'https://wp.example/feed/';
    const chapters = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel-toc/ch-${i + 1}/`);
    const p = ports({
      // Site-wide feed: other novels, no category, date permalinks → chooseSeriesMatch returns null.
      [feedUrl]: ok(
        RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/') + ITEM('o2', 'https://wp.example/2026/08/11/misc-ch-9/')),
      ),
      [url]: ok(pageWithToc(feedUrl, chapters)),
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('PAGE_WATCH');
    expect(result.resolved.feedUrl).toBeNull();
    expect(result.resolved.fetchMode).toBe('PLAIN');
    expect(result.resolved.match).toEqual({ type: 'WHOLE_FEED' }); // page-watch is already series-scoped
    // Seeded from the page TOC, not the feed (order-independent: the other novels' feed items are absent).
    expect([...result.resolved.chapters.map((c) => c.url)].sort()).toEqual([...chapters].sort());
  });

  test('WP-49: advertised feed we cannot isolate but the page is NOT a TOC (≤5 links) → stays FEED WHOLE_FEED', async () => {
    const url = 'https://wp.example/novel-toc/';
    const feedUrl = 'https://wp.example/feed/';
    const p = ports({
      [feedUrl]: ok(RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/'))),
      // Page advertises the feed but has only 2 chapter-ish links → not a real TOC.
      [url]: ok(pageWithToc(feedUrl, ['https://wp.example/novel-toc/ch-1/', 'https://wp.example/novel-toc/ch-2/'])),
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.feedUrl).toBe(feedUrl);
    expect(result.resolved.match).toEqual({ type: 'WHOLE_FEED' });
  });

  test('WP-49: a positive CATEGORY match is never diverted, even with a rich page TOC', async () => {
    const url = 'https://wp.example/novel/beta/';
    const feedUrl = 'https://wp.example/feed/';
    const chapters = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel/beta/ch-${i + 1}/`);
    const p = ports({
      // A per-novel category matching the series slug → chooseSeriesMatch returns CATEGORY (not null).
      [feedUrl]: ok(RSS(ITEM('g1', 'https://wp.example/beta-1/', 'Beta') + ITEM('g2', 'https://wp.example/other-1/', 'Other Tale'))),
      [url]: ok(pageWithToc(feedUrl, chapters)),
    });

    const result = await addSeries({ url }, p);

    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.match).toEqual({ type: 'CATEGORY', value: 'Beta' });
  });

  test('WP-49: a GUESSED feed is never diverted, even with a rich page TOC', async () => {
    const url = 'https://wp.example/novel/omega2/';
    const feedUrl = 'https://wp.example/feed/'; // the site-wide guess guessFeedUrls produces
    const chapters = Array.from({ length: 6 }, (_, i) => `https://wp.example/novel/omega2/ch-${i + 1}/`);
    // Page has NO advertised <link alternate> feed, but a rich TOC.
    const toc = `<html><body><ul>${chapters.map((u, i) => `<li><a href="${u}">Chapter ${i + 1}</a></li>`).join('')}</ul></body></html>`;
    const p = ports({
      [url]: ok(toc),
      // No category, date-permalink URLs not under the series path → chooseSeriesMatch returns null.
      [feedUrl]: ok(
        RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/') + ITEM('o2', 'https://wp.example/2026/08/11/misc-ch-9/')),
      ),
      // the page-level guess (…/novel/omega2/feed/) is left to default 404
    });

    const result = await addSeries({ url }, p);

    // usedGuesses is true here, so cantIsolateAdvertised is false regardless of the rich TOC —
    // must stay FEED (with a fallbackSeriesMatch), not divert to PAGE_WATCH.
    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.feedUrl).toBe(feedUrl);
  });

  test('WP-49: the exact =5 lower boundary (pageToc.length === RENDER_ESCALATION_MAX) stays FEED', async () => {
    const url = 'https://wp.example/novel-toc/';
    const feedUrl = 'https://wp.example/feed/';
    const chapters = Array.from({ length: 5 }, (_, i) => `https://wp.example/novel-toc/ch-${i + 1}/`);
    const p = ports({
      // Site-wide feed: other novels, no category, date permalinks → chooseSeriesMatch returns null.
      [feedUrl]: ok(
        RSS(ITEM('o1', 'https://wp.example/2026/08/11/other-ch-1/') + ITEM('o2', 'https://wp.example/2026/08/11/misc-ch-9/')),
      ),
      [url]: ok(pageWithToc(feedUrl, chapters)),
    });

    const result = await addSeries({ url }, p);

    // The guard is strict `> 5`; exactly 5 chapter links must NOT divert.
    expect(result.resolved.type).toBe('FEED');
    expect(result.resolved.match).toEqual({ type: 'WHOLE_FEED' });
  });
});

describe('addSeries dedup (WP-39)', () => {
  const url = 'https://translator.example/novel/alpha/';
  const feedUrl = 'https://translator.example/feed/';
  const map = { [url]: ok(PAGE(feedUrl)), [feedUrl]: ok(RSS(ITEM('g1', 'https://translator.example/alpha-1/'))) };

  test('a new series is created with a canonicalId and alreadyExisting=false', async () => {
    const p = ports(map);
    const result = await addSeries({ url }, p);
    expect(result.alreadyExisting).toBe(false);
    expect(p.created).toHaveLength(1);
    expect(p.created[0]!.canonicalId).toBe('translator.example/feed#WHOLE_FEED');
    expect(result.resolved.canonicalId).toBe('translator.example/feed#WHOLE_FEED');
  });

  test('a duplicate (canonicalId already present) returns the existing series and does NOT create', async () => {
    const p = ports(map, (id) => (id === 'translator.example/feed#WHOLE_FEED' ? { seriesId: 'existing1' } : null));
    const result = await addSeries({ url }, p);
    expect(result.alreadyExisting).toBe(true);
    expect(result.seriesId).toBe('existing1');
    expect(p.created).toHaveLength(0); // createSeries never called
  });
});
