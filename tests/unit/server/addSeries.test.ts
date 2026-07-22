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

function ports(map: Record<string, PoliteResult>): AddSeriesPorts & { created: ResolvedSource[] } {
  const created: ResolvedSource[] = [];
  return {
    created,
    fetch: async (url) => map[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult),
    createSeries: async (resolved) => {
      created.push(resolved);
      return { seriesId: 'new1' };
    },
  };
}

describe('addSeries', () => {
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
});
