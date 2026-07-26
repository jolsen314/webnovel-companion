import { describe, expect, test } from 'vitest';
import { pollSource, type PollableSource, type PollPorts } from '../../../src/server/services/poll';
import type { PoliteResult } from '../../../src/lib/feeds/fetch';
import type { SeriesMatch } from '../../../src/lib/feeds/discover';
import type { KnownChapter } from '../../../src/lib/feeds/diff';

const RSS = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;
const ITEM = (guid: string, url: string, title = guid, category?: string) =>
  `<item><title>${title}</title><link>${url}</link><guid>${guid}</guid>${category ? `<category><![CDATA[${category}]]></category>` : ''}</item>`;

function source(overrides: Partial<PollableSource> = {}): PollableSource {
  return {
    id: 's1',
    seriesId: 'series1',
    type: 'FEED',
    fetchMode: 'PLAIN',
    fetchUrl: 'https://feed.example/rss',
    match: { type: 'WHOLE_FEED' },
    etag: null,
    lastModified: null,
    health: 'HEALTHY',
    consecutiveFailures: 0,
    failureScore: 0,
    lastFailureType: null,
    ...overrides,
  };
}

function ports(
  fetchResult: PoliteResult,
  stored: KnownChapter[] = [],
): PollPorts & { applied: unknown[] } {
  const applied: unknown[] = [];
  return {
    applied,
    fetch: async () => fetchResult,
    loadStoredChapters: async () => stored,
    applyPollEffects: async (e) => {
      applied.push(e);
    },
  };
}

const ok = (body: string, extra: Partial<Extract<PoliteResult, { outcome: 'SUCCESS' }>> = {}): PoliteResult => ({
  outcome: 'SUCCESS',
  status: 200,
  notModified: false,
  body,
  etag: null,
  lastModified: null,
  finalUrl: 'https://feed.example/rss',
  ...extra,
});

describe('pollSource', () => {
  test('success with new items: diffs, stays HEALTHY, captures validators, persists effects', async () => {
    const feed = RSS(ITEM('g2', 'https://x.example/c2') + ITEM('g1', 'https://x.example/c1'));
    const p = ports(ok(feed, { etag: '"e1"' }));

    const effects = await pollSource(source(), p);

    expect(effects.newChapters.map((c) => c.guid)).toEqual(['g2', 'g1']);
    expect(effects.health.health).toBe('HEALTHY');
    expect(effects.etag).toBe('"e1"');
    expect(effects.notModified).toBe(false);
    expect(p.applied).toHaveLength(1);
  });

  test('304 not-modified: no new chapters, stays HEALTHY, keeps prior validators', async () => {
    const notMod: PoliteResult = {
      outcome: 'SUCCESS',
      status: 304,
      notModified: true,
      body: '',
      etag: null,
      lastModified: null,
      finalUrl: 'https://feed.example/rss',
    };
    const effects = await pollSource(source({ etag: '"old"' }), ports(notMod));

    expect(effects.notModified).toBe(true);
    expect(effects.newChapters).toEqual([]);
    expect(effects.health.health).toBe('HEALTHY');
    expect(effects.etag).toBe('"old"');
  });

  test('a failure escalates health and yields no chapters (DNS from healthy → DEGRADED)', async () => {
    const effects = await pollSource(source(), ports({ outcome: 'DNS' }));

    expect(effects.health.health).toBe('DEGRADED');
    expect(effects.newChapters).toEqual([]);
    expect(effects.crossedDown).toBe(false);
  });

  test('crossing into LIKELY_DOWN sets crossedDown (for the "source may be down" alert)', async () => {
    const degraded = source({ health: 'DEGRADED', failureScore: 3, consecutiveFailures: 1, lastFailureType: 'DNS' });
    const effects = await pollSource(degraded, ports({ outcome: 'DNS' }));

    expect(effects.health.health).toBe('LIKELY_DOWN');
    expect(effects.crossedDown).toBe(true);
  });

  test('applies the series matcher: only items of this series (by category) are new', async () => {
    const feed = RSS(
      ITEM('gk', 'https://x.example/keep', 'Keep', 'Silver Moon Saga') +
        ITEM('gs', 'https://x.example/skip', 'Skip', 'Other Tale'),
    );
    const effects = await pollSource(source({ match: { type: 'CATEGORY', value: 'Silver Moon Saga' } }), ports(ok(feed)));

    expect(effects.newChapters.map((c) => c.guid)).toEqual(['gk']);
  });

  test('PAGE_WATCH source: parses the TOC and diffs new chapters with access state', async () => {
    const toc = `<ul>
      <li><a href="https://x.example/novel/a/chapter-1/">Chapter 1</a></li>
      <li class="premium"><a href="https://x.example/novel/a/chapter-2/">Chapter 2</a></li>
    </ul>`;

    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchUrl: 'https://x.example/novel/a/', match: { type: 'WHOLE_FEED' } }),
      ports(ok(toc)),
    );

    expect(effects.newChapters.map((c) => c.url)).toEqual([
      'https://x.example/novel/a/chapter-1/',
      'https://x.example/novel/a/chapter-2/',
    ]);
    expect(effects.newChapters.map((c) => c.access)).toEqual(['FREE', 'LOCKED']);
  });

  // ── WP-17b: render fetch mode + escalation ──────────────────────────────
  function renderPorts(
    plain: PoliteResult,
    render: PoliteResult,
    stored: KnownChapter[] = [],
  ): PollPorts & { applied: unknown[] } {
    const applied: unknown[] = [];
    return {
      applied,
      fetch: async () => plain,
      renderFetch: async () => render,
      loadStoredChapters: async () => stored,
      applyPollEffects: async (e) => {
        applied.push(e);
      },
    };
  }

  const toc = (...urls: string[]) =>
    `<ul>${urls.map((u) => `<li><a href="${u}">Chapter</a></li>`).join('')}</ul>`;

  test('a RENDER-mode source fetches via the render port, not plain fetch', async () => {
    const p = renderPorts(ok(toc('https://x.example/plain-1/')), ok(toc('https://x.example/render-1/')));
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'RENDER', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.newChapters.map((c) => c.url)).toEqual(['https://x.example/render-1/']);
  });

  test('escalates a PAGE_WATCH source to RENDER when a plain fetch yields ≤5 chapters and a renderer exists', async () => {
    const p = renderPorts(ok(toc('https://x.example/a/chapter-1/')), ok('<ul></ul>'));
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(true);
  });

  test('does not escalate when the plain TOC is already rich (>5 chapters)', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://x.example/a/chapter-${i + 1}/`);
    const p = renderPorts(ok(toc(...urls)), ok('<ul></ul>'));
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not escalate a FEED source, even with few items', async () => {
    const p = renderPorts(ok(RSS(ITEM('g1', 'https://x.example/c1'))), ok('<ul></ul>'));
    const effects = await pollSource(source({ type: 'FEED', fetchMode: 'PLAIN' }), p);
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not escalate when no renderer is configured (plain-only ports)', async () => {
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      ports(ok(toc('https://x.example/a/chapter-1/'))),
    );
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not re-report already-stored chapters', async () => {
    const feed = RSS(ITEM('g2', 'https://x.example/c2') + ITEM('g1', 'https://x.example/c1'));
    const stored = [{ guid: 'g1', url: 'https://x.example/c1' }];
    const effects = await pollSource(source(), ports(ok(feed), stored));

    expect(effects.newChapters.map((c) => c.guid)).toEqual(['g2']);
  });
});
