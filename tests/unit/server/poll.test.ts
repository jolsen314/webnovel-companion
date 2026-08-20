import { describe, expect, test, vi } from 'vitest';
import {
  chooseConditionalState,
  groupCostMs,
  groupPollSources,
  hostGate,
  MIN_POLL_INTERVAL_MINUTES,
  orderGroupsByStaleness,
  PLAIN_COST_MS,
  POLL_BUDGET_MS,
  pollAllSources,
  processFetched,
  POLLABLE_STATUSES,
  RENDER_COST_MS,
  sourceTierWhere,
  statusPollGate,
  type PollableSource,
  type PollEffects,
  type PollGroup,
  type PollPorts,
  type PollTier,
  type SeriesStatus,
} from '../../../src/server/services/poll';
import { parseRetryAfter, type PoliteResult } from '../../../src/lib/feeds/fetch';
import type { SeriesMatch } from '../../../src/lib/feeds/discover';
import type { KnownChapter } from '../../../src/lib/feeds/diff';
import type { FailureType } from '../../../src/lib/health';
import { type ApiDescriptor } from '../../../src/lib/feeds/apiAdapter';

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
    host: 'x.example',
    lastCheckedAt: null,
    backoffUntil: null,
    seriesStatus: 'READING',
    apiMap: null,
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

/** Poll a single source in isolation (fetch → processFetched → persist). A TEST-ONLY harness for
 *  the single-source fetch→health→parse→diff pipeline — production polls via `pollAllSources`,
 *  which layers the status/host/budget gates. Deliberately not exported from poll.ts (nothing in
 *  production should poll a lone source without those gates). */
async function pollSource(src: PollableSource, ports: PollPorts): Promise<PollEffects> {
  const fetcher = src.fetchMode === 'RENDER' && ports.renderFetch ? ports.renderFetch : ports.fetch;
  const res = await fetcher(src.fetchUrl, { etag: src.etag, lastModified: src.lastModified });
  const retryAfterAt = parseRetryAfter(res.retryAfter ?? null, new Date());
  const effects = await processFetched(src, res, retryAfterAt, ports);
  await ports.applyPollEffects(effects);
  return effects;
}

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

  test('becameFree stays empty on a 304 and on a failure', async () => {
    const notMod: PoliteResult = {
      outcome: 'SUCCESS', status: 304, notModified: true, body: '', etag: null, lastModified: null,
      finalUrl: 'https://feed.example/rss',
    };
    expect((await pollSource(source(), ports(notMod))).becameFree).toEqual([]);
    expect((await pollSource(source(), ports({ outcome: 'DNS' }))).becameFree).toEqual([]);
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

  test('escalates a PAGE_WATCH source to RENDER when a plain read regresses below stored', async () => {
    const stored = [
      { guid: 's1', url: 'https://x.example/a/chapter-1/' },
      { guid: 's2', url: 'https://x.example/a/chapter-2/' },
      { guid: 's3', url: 'https://x.example/a/chapter-3/' },
    ];
    const p = renderPorts(ok(toc('https://x.example/a/chapter-1/')), ok('<ul></ul>'), stored);
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(true); // plain read 1 < stored 3
  });

  test('does not escalate a genuinely small series (plain read == stored count)', async () => {
    const stored = [{ guid: 's1', url: 'https://x.example/a/chapter-1/' }];
    const p = renderPorts(ok(toc('https://x.example/a/chapter-1/')), ok('<ul></ul>'), stored);
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(false); // plain read 1, stored 1 → no regression
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

  // ── WP-52: poll-time hard-fail (Cloudflare 403) render escalation ──────────
  const fail = (outcome: FailureType, status?: number): PoliteResult => ({ outcome, status, retryAfter: null });

  test('escalates a PAGE_WATCH source to RENDER on a Cloudflare 403 block', async () => {
    const p = renderPorts(fail('HTTP_4XX', 403), ok('<ul></ul>'));
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(true);
  });

  test('does not escalate on a 404 (page gone, not blocked — render would not help)', async () => {
    const p = renderPorts(fail('HTTP_4XX', 404), ok('<ul></ul>'));
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not escalate a FEED source on a 403 (a feed polls plainly)', async () => {
    const p = renderPorts(fail('HTTP_4XX', 403), ok('<ul></ul>'));
    const effects = await pollSource(source({ type: 'FEED', fetchMode: 'PLAIN' }), p);
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not escalate a 403 when already RENDER mode', async () => {
    // RENDER-mode goes through renderFetch; simulate that transport also returning a 403.
    const p = renderPorts(ok('<ul></ul>'), fail('HTTP_4XX', 403));
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'RENDER', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not escalate on a 403 when no renderer is configured', async () => {
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } }),
      ports(fail('HTTP_4XX', 403)),
    );
    expect(effects.escalateToRender).toBe(false);
  });

  test('does not escalate on a transient timeout / 5xx (not a block signature)', async () => {
    const src = source({ type: 'PAGE_WATCH', fetchMode: 'PLAIN', fetchUrl: 'https://x.example/a/', match: { type: 'WHOLE_FEED' } });
    const timeout = await pollSource(src, renderPorts(fail('TIMEOUT'), ok('<ul></ul>')));
    expect(timeout.escalateToRender).toBe(false);
    const server = await pollSource(src, renderPorts(fail('HTTP_5XX', 503), ok('<ul></ul>')));
    expect(server.escalateToRender).toBe(false);
  });

  test('does not re-report already-stored chapters', async () => {
    const feed = RSS(ITEM('g2', 'https://x.example/c2') + ITEM('g1', 'https://x.example/c1'));
    const stored = [{ guid: 'g1', url: 'https://x.example/c1' }];
    const effects = await pollSource(source(), ports(ok(feed), stored));

    expect(effects.newChapters.map((c) => c.guid)).toEqual(['g2']);
  });

  test('PAGE_WATCH: a stored LOCKED chapter now FREE in the TOC is reported in becameFree', async () => {
    const tocHtml = `<ul>
      <li><a href="https://x.example/novel/a/chapter-1/">Chapter 1</a></li>
      <li><a href="https://x.example/novel/a/chapter-2/">Chapter 2</a></li>
    </ul>`;
    const p = ports(ok(tocHtml), [{ url: 'https://x.example/novel/a/chapter-2/', access: 'LOCKED' }]);

    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchUrl: 'https://x.example/novel/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );

    expect(effects.newChapters.map((c) => c.url)).toEqual(['https://x.example/novel/a/chapter-1/']);
    expect(effects.becameFree.map((c) => c.url)).toEqual(['https://x.example/novel/a/chapter-2/']);
  });

  test('PAGE_WATCH: a stored UNKNOWN chapter the TOC marks LOCKED surfaces in accessReconciled', async () => {
    const tocHtml = `<ul><li class="premium"><a href="https://x.example/novel/a/chapter-1/">Chapter 1</a></li></ul>`;
    const p = ports(ok(tocHtml), [{ url: 'https://x.example/novel/a/chapter-1/', access: undefined }]);
    const effects = await pollSource(
      source({ type: 'PAGE_WATCH', fetchUrl: 'https://x.example/novel/a/', match: { type: 'WHOLE_FEED' } }),
      p,
    );
    expect(effects.newChapters).toEqual([]);
    expect(effects.accessReconciled.map((c) => c.url)).toEqual(['https://x.example/novel/a/chapter-1/']);
  });

  // ── WP-45: API source ────────────────────────────────────────────────────
  test('API source: JSON body → new chapters diffed and seeded', async () => {
    const api: ApiDescriptor = { urlField: 'url', titleField: 'title', isFreeField: 'free' };
    const src = source({
      type: 'API',
      fetchMode: 'PLAIN',
      fetchUrl: 'https://api.example/works/1/chapters',
      apiMap: api,
    });
    const body = JSON.stringify([
      { title: 'Ch 1', url: 'https://api.example/read/1', free: true },
      { title: 'Ch 2', url: 'https://api.example/read/2', free: true },
    ]);
    const effects = await processFetched(src, ok(body), null, ports(ok(body), []));
    expect(effects.newChapters.map((c) => c.url)).toEqual([
      'https://api.example/read/1',
      'https://api.example/read/2',
    ]);
  });

  test('API source: a LOCKED→FREE isFree flip produces a becameFree effect', async () => {
    const api: ApiDescriptor = { urlField: 'url', titleField: 'title', isFreeField: 'free' };
    const src = source({
      type: 'API',
      fetchMode: 'PLAIN',
      fetchUrl: 'https://api.example/works/1/chapters',
      apiMap: api,
    });
    const stored = [{ id: 'c1', url: 'https://api.example/read/1', access: 'LOCKED' as const }];
    const body = JSON.stringify([{ title: 'Ch 1', url: 'https://api.example/read/1', free: true }]);
    const effects = await processFetched(src, ok(body), null, ports(ok(body), stored));
    expect(effects.becameFree.map((c) => c.id)).toEqual(['c1']);
    expect(effects.newChapters).toEqual([]);
  });
});

describe('groupPollSources', () => {
  test('collapses sources sharing (fetchMode, fetchUrl)', () => {
    const a = source({ id: 'a', fetchUrl: 'https://s.example/feed/', fetchMode: 'PLAIN' });
    const b = source({ id: 'b', fetchUrl: 'https://s.example/feed/', fetchMode: 'PLAIN' });
    const c = source({ id: 'c', fetchUrl: 'https://s.example/feed/', fetchMode: 'RENDER' });
    const groups = groupPollSources([a, b, c]);
    expect(groups).toHaveLength(2); // (PLAIN,feed) has a+b; (RENDER,feed) has c
    const shared = groups.find((g) => g.fetchMode === 'PLAIN')!;
    expect(shared.sources.map((s) => s.id).sort()).toEqual(['a', 'b']);
    const rendered = groups.find((g) => g.fetchMode === 'RENDER')!;
    expect(rendered.sources.map((s) => s.id)).toEqual(['c']);
  });

  test('derives group.host from the fetched feed host, not the stored page host', () => {
    const s = source({ host: 'page.example', fetchUrl: 'https://feed-cdn.example/rss' });
    const [group] = groupPollSources([s]);
    expect(group!.host).toBe('feed-cdn.example');
  });

  test('falls back to the stored host when fetchUrl does not parse as a URL', () => {
    const s = source({ host: 'page.example', fetchUrl: 'not-a-url' });
    const [group] = groupPollSources([s]);
    expect(group!.host).toBe('page.example');
  });
});

describe('pollAllSources', () => {
  const NOW = new Date('2026-07-29T12:00:00Z');
  const FEED = 'https://feed.example/rss';

  function multiPorts(args: {
    sources: PollableSource[];
    fetch: PollPorts['fetch'];
    /** WP-45b: renderFetch for paginated-API/RENDER groups (and general RENDER-mode tests). */
    renderFetch?: PollPorts['renderFetch'];
    stored?: Record<string, KnownChapter[]>;
    /** When set, a processed source's lastCheckedAt is stamped to this (mirroring the real edge),
     *  so a multi-run test exercises rotation/cadence across runs. Omit for single-run tests. */
    now?: Date;
  }): PollPorts & { loadActiveSources: () => Promise<PollableSource[]>; applied: PollEffects[] } {
    const applied: PollEffects[] = [];
    return {
      applied,
      fetch: args.fetch,
      renderFetch: args.renderFetch,
      loadActiveSources: async () => args.sources,
      loadStoredChapters: async (seriesId) => args.stored?.[seriesId] ?? [],
      applyPollEffects: async (e) => {
        applied.push(e);
        // Mirror the real edge (index.ts pollPorts): a processed source's lastCheckedAt is stamped
        // to the run's `now`, so rotation (WP-41) + status cadence have real timestamps to work on
        // across successive runs.
        if (args.now) {
          const src = args.sources.find((s) => s.id === e.sourceId);
          if (src) src.lastCheckedAt = args.now;
        }
      },
    };
  }

  test('two series on one feed → the feed is fetched ONCE, both get their new chapter', async () => {
    const feed = RSS(ITEM('g1', 'https://x.example/c1'));
    const s1 = source({ id: 's1', seriesId: 'ser1', fetchUrl: FEED });
    const s2 = source({ id: 's2', seriesId: 'ser2', fetchUrl: FEED });
    let fetches = 0;
    const p = multiPorts({
      sources: [s1, s2],
      fetch: async () => {
        fetches++;
        return ok(feed);
      },
      stored: { ser1: [], ser2: [] },
    });

    await pollAllSources(p, NOW);

    expect(fetches).toBe(1); // ONE fetch for the shared feed
    expect(p.applied.filter((e) => e.newChapters.length === 1)).toHaveLength(2); // both series diffed it
  });

  test('429 with Retry-After → every source on the host gets backoffUntil', async () => {
    const s1 = source({ id: 's1', seriesId: 'ser1', fetchUrl: FEED, host: 'h.example' });
    const p = multiPorts({
      sources: [s1],
      fetch: async () => ({ outcome: 'HTTP_4XX', status: 429, retryAfter: '120' }),
      stored: { ser1: [] },
    });

    await pollAllSources(p, NOW);

    expect(p.applied[0]!.backoffUntil).toEqual(new Date(NOW.getTime() + 120_000));
  });

  test('429 on a shared feed → BOTH sources in the group get backoffUntil, not just one', async () => {
    const s1 = source({ id: 's1', seriesId: 'ser1', fetchUrl: FEED, host: 'h.example' });
    const s2 = source({ id: 's2', seriesId: 'ser2', fetchUrl: FEED, host: 'h.example' });
    const p = multiPorts({
      sources: [s1, s2],
      fetch: async () => ({ outcome: 'HTTP_4XX', status: 429, retryAfter: '120' }),
      stored: { ser1: [], ser2: [] },
    });

    await pollAllSources(p, NOW);

    expect(p.applied).toHaveLength(2);
    const expected = new Date(NOW.getTime() + 120_000);
    expect(p.applied.map((e) => e.backoffUntil)).toEqual([expected, expected]);
  });

  test('200 with a new etag on a shared feed → BOTH sources carry the shared etag', async () => {
    const feed = RSS(ITEM('g1', 'https://x.example/c1'));
    const s1 = source({ id: 's1', seriesId: 'ser1', fetchUrl: FEED });
    const s2 = source({ id: 's2', seriesId: 'ser2', fetchUrl: FEED });
    const p = multiPorts({
      sources: [s1, s2],
      fetch: async () => ok(feed, { etag: '"v2"' }),
      stored: { ser1: [], ser2: [] },
    });

    await pollAllSources(p, NOW);

    expect(p.applied).toHaveLength(2);
    expect(p.applied.map((e) => e.etag)).toEqual(['"v2"', '"v2"']);
  });

  test('a host past its min-interval last-checked skips the whole group without fetching', async () => {
    const recentlyChecked = new Date(NOW.getTime() - 5 * 60_000); // 5 min ago, < 15 min floor
    const s1 = source({ id: 's1', seriesId: 'ser1', fetchUrl: FEED, host: 'h.example', lastCheckedAt: recentlyChecked });
    let fetches = 0;
    const p = multiPorts({
      sources: [s1],
      fetch: async () => {
        fetches++;
        return ok(RSS(''));
      },
      stored: { ser1: [] },
    });

    const effects = await pollAllSources(p, NOW);

    expect(fetches).toBe(0);
    expect(effects).toEqual([]);
    expect(p.applied).toEqual([]);
  });

  test('the host gate keys on the FETCHED feed host, not the stored page host', async () => {
    const recentlyChecked = new Date(NOW.getTime() - 5 * 60_000); // 5 min ago, < 15 min floor
    // Two sources with DIFFERENT stored page hosts but the SAME actual feed host (e.g. both
    // proxied through a shared feed endpoint) — distinct fetchUrls, so distinct groups.
    const s1 = source({
      id: 's1',
      seriesId: 'ser1',
      host: 'site-a.example', // stored page host
      fetchUrl: 'https://feeds.hub.example/site-a.xml', // actual feed host: feeds.hub.example
      lastCheckedAt: recentlyChecked,
    });
    const s2 = source({
      id: 's2',
      seriesId: 'ser2',
      host: 'site-b.example', // different stored page host
      fetchUrl: 'https://feeds.hub.example/site-b.xml', // SAME actual feed host
      lastCheckedAt: null,
    });
    let fetches = 0;
    const p = multiPorts({
      sources: [s1, s2],
      fetch: async () => {
        fetches++;
        return ok(RSS(''));
      },
      stored: { ser1: [], ser2: [] },
    });

    const effects = await pollAllSources(p, NOW);

    // s1's recent lastCheckedAt gates BOTH groups, because they share a feed host — even though
    // s2's own stored page host has never been checked. Keying on the page host would leave s2's
    // group ungated and fetch it.
    expect(fetches).toBe(0);
    expect(effects).toEqual([]);
  });

  // ── WP-45b: paginated API sources — the fetch seam (not processFetched) branches on
  // apiMap.pagination, so these exercise pollAllSources (the real group-level fetch path),
  // not a processFetched-only harness.
  describe('pollAllSources — paginated API source (WP-45b)', () => {
    test('paginated API/PLAIN source unions pages then diffs all chapters', async () => {
      const api: ApiDescriptor = { urlField: 'url', titleField: 't', pagination: { pageParam: 'page', perPage: 200 } };
      const src = source({ type: 'API', fetchMode: 'PLAIN', fetchUrl: 'https://api.example/ch?per_page=200', apiMap: api });
      const page = (n: number, count: number) =>
        ok(JSON.stringify(Array.from({ length: count }, (_, i) => ({ url: `https://api.example/c${n}-${i}`, t: 'C' }))));
      // fake fetch serves page 1 = 200 items, page 2 = 5 items (short → stop). Reads the actual
      // `page` query param (NOT a raw substring check) — the base URL's own `per_page=200`
      // already contains the substring "page=2", so a naive `.includes` would misfire.
      const p = multiPorts({
        sources: [src],
        fetch: async (u: string) => (new URL(u).searchParams.get('page') === '2' ? page(2, 5) : page(1, 200)),
        stored: { series1: [] },
      });

      const effects = await pollAllSources(p, NOW);

      expect(effects).toHaveLength(1);
      expect(effects[0]!.newChapters).toHaveLength(205);
    });

    test('paginated API/RENDER source: renderFetch called once WITH the pagination spec, union diffed, becameFree fires', async () => {
      const api: ApiDescriptor = {
        urlField: 'url',
        titleField: 't',
        isFreeField: 'locked',
        isFreeWhen: 'falsy',
        pagination: { pageParam: 'page', perPage: 200 },
      };
      const src = source({ type: 'API', fetchMode: 'RENDER', fetchUrl: 'https://api.example/ch', apiMap: api });
      const renderFetch = vi.fn(async (_url: string, _opts?: unknown) =>
        ok(JSON.stringify([{ url: 'https://api.example/c1', t: 'C1', locked: false }])),
      );
      const fetch = vi.fn(async () => ok('[]')); // should not be called — RENDER mode goes through renderFetch
      const p = multiPorts({
        sources: [src],
        fetch,
        renderFetch,
        stored: { series1: [{ id: 'x', url: 'https://api.example/c1', access: 'LOCKED' }] },
      });

      const effects = await pollAllSources(p, NOW);

      expect(renderFetch).toHaveBeenCalledTimes(1);
      // The call must carry the pagination spec (so the render service knows to paginate
      // in-browser) — NOT the plain etag/lastModified opts a non-paginated RENDER group sends.
      // This is the assertion that actually differs from the pre-WP-45b routing (which always
      // called renderFetch once too, just with the wrong opts) — a call-count-only check would
      // pass even without the fetch-seam branch wired in.
      expect(renderFetch.mock.calls[0]![1]).toEqual({ pagination: api.pagination });
      // Explicit non-regression: paginated-API/RENDER routing must never fall through to the
      // PLAIN fetch port (only renderFetch does the in-browser page loop).
      expect(fetch).not.toHaveBeenCalled();
      expect(effects[0]!.becameFree.map((c) => c.id)).toEqual(['x']);
    });
  });

  describe('pollAllSources — status/cadence gate (WP-27a)', () => {
    const NOW = new Date('2026-07-30T12:00:00Z');
    const OVER_A_WEEK = new Date(NOW.getTime() - 8 * 24 * 60 * 60_000);
    const THREE_DAYS = new Date(NOW.getTime() - 3 * 24 * 60 * 60_000);
    const FEED = (h: string) => `https://${h}/rss`;

    test('a solo not-due PLANNED group is not fetched', async () => {
      const s = source({ id: 'p', seriesId: 'serP', host: 'p.example', fetchUrl: FEED('p.example'), seriesStatus: 'PLANNED', lastCheckedAt: THREE_DAYS });
      let fetches = 0;
      const p = multiPorts({ sources: [s], fetch: async () => { fetches++; return ok(RSS('')); }, stored: { serP: [] } });

      const effects = await pollAllSources(p, NOW);

      expect(fetches).toBe(0);
      expect(effects).toEqual([]);
    });

    test('a mixed group [READING, not-due PLANNED] fetches once and processes BOTH (the not-due sibling rides the shared fetch)', async () => {
      const feed = FEED('shared.example');
      const r = source({ id: 'r', seriesId: 'serR', host: 'shared.example', fetchUrl: feed, seriesStatus: 'READING' });
      const pl = source({ id: 'pl', seriesId: 'serPl', host: 'shared.example', fetchUrl: feed, seriesStatus: 'PLANNED', lastCheckedAt: THREE_DAYS });
      let fetches = 0;
      const p = multiPorts({ sources: [r, pl], fetch: async () => { fetches++; return ok(RSS(ITEM('g1', 'https://x/c1'))); }, stored: { serR: [], serPl: [] } });

      await pollAllSources(p, NOW);

      // The fetch is triggered by the due READING sibling; since it's already paid for, the not-due
      // PLANNED source is processed too (free backlog freshness) rather than left stale.
      expect(fetches).toBe(1);
      expect(p.applied.map((e) => e.seriesId).sort()).toEqual(['serPl', 'serR']);
    });

    test('a mixed group [READING, due PLANNED] fetches once, processes BOTH', async () => {
      const feed = FEED('shared2.example');
      const r = source({ id: 'r2', seriesId: 'serR2', host: 'shared2.example', fetchUrl: feed, seriesStatus: 'READING' });
      const pl = source({ id: 'pl2', seriesId: 'serPl2', host: 'shared2.example', fetchUrl: feed, seriesStatus: 'PLANNED', lastCheckedAt: OVER_A_WEEK });
      let fetches = 0;
      const p = multiPorts({ sources: [r, pl], fetch: async () => { fetches++; return ok(RSS(ITEM('g1', 'https://x/c1'))); }, stored: { serR2: [], serPl2: [] } });

      await pollAllSources(p, NOW);

      expect(fetches).toBe(1);
      expect(p.applied.map((e) => e.seriesId).sort()).toEqual(['serPl2', 'serR2']);
    });

    test('a PLANNED source past its weekly window is polled', async () => {
      const s = source({ id: 'p', seriesId: 'serP', host: 'p.example', fetchUrl: FEED('p.example'), seriesStatus: 'PLANNED', lastCheckedAt: OVER_A_WEEK });
      let fetches = 0;
      const p = multiPorts({ sources: [s], fetch: async () => { fetches++; return ok(RSS('')); }, stored: { serP: [] } });

      await pollAllSources(p, NOW);

      expect(fetches).toBe(1);
      expect(p.applied.map((e) => e.seriesId)).toEqual(['serP']);
    });

    test('a due PLANNED deferred by budget is picked up on the next run (not starved)', async () => {
      // Two due sources; a budget that fits only one. Run twice; the one skipped first is polled next.
      const a = source({ id: 'a', seriesId: 'serA', host: 'a.example', fetchUrl: FEED('a.example'), seriesStatus: 'PLANNED', lastCheckedAt: new Date(NOW.getTime() - 9 * 24 * 60 * 60_000) });
      const b = source({ id: 'b', seriesId: 'serB', host: 'b.example', fetchUrl: FEED('b.example'), seriesStatus: 'PLANNED', lastCheckedAt: OVER_A_WEEK });
      let t = 0;
      const clock = () => t;
      const p = multiPorts({ sources: [a, b], fetch: async () => { t += PLAIN_COST_MS; return ok(RSS('')); }, stored: { serA: [], serB: [] }, now: NOW });

      const first = await pollAllSources(p, NOW, { budgetMs: PLAIN_COST_MS, clock });
      expect(first).toHaveLength(1); // only the stalest fit the budget
      const firstId = first[0]!.seriesId;
      const secondId = firstId === 'serA' ? 'serB' : 'serA';

      t = 0; // fresh run
      const second = await pollAllSources(p, NOW, { budgetMs: PLAIN_COST_MS, clock });
      expect(second.map((e) => e.seriesId)).toContain(secondId); // the deferred one is now polled
    });
  });
});

describe('chooseConditionalState', () => {
  test('all sources share one etag → send that etag', () => {
    const g = [source({ etag: 'W/"v1"' }), source({ etag: 'W/"v1"' })];
    expect(chooseConditionalState(g)).toEqual({ etag: 'W/"v1"', lastModified: null });
  });

  test('etags diverge → no conditional (full fetch)', () => {
    const g = [source({ etag: 'W/"v1"' }), source({ etag: 'W/"v2"' })];
    expect(chooseConditionalState(g)).toEqual({ etag: null, lastModified: null });
  });

  test('a new source (null etag) → full fetch even if others match', () => {
    const g = [source({ etag: 'W/"v1"' }), source({ etag: null })];
    expect(chooseConditionalState(g)).toEqual({ etag: null, lastModified: null });
  });

  test('no etags but a shared lastModified → send If-Modified-Since', () => {
    const g = [
      source({ etag: null, lastModified: 'Mon, 28 Jul 2026 10:00:00 GMT' }),
      source({ etag: null, lastModified: 'Mon, 28 Jul 2026 10:00:00 GMT' }),
    ];
    expect(chooseConditionalState(g)).toEqual({ etag: null, lastModified: 'Mon, 28 Jul 2026 10:00:00 GMT' });
  });
});

describe('hostGate', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  const min = MIN_POLL_INTERVAL_MINUTES * 60_000;

  test('backoff in the future → skip:backoff (takes precedence)', () => {
    expect(hostGate({ hostLastCheckedAt: null, hostBackoffUntil: new Date('2026-07-29T12:30:00Z'), now, minIntervalMs: min }))
      .toEqual({ skip: true, reason: 'backoff' });
  });
  test('polled 5 min ago (< interval) → skip:min-interval', () => {
    expect(hostGate({ hostLastCheckedAt: new Date('2026-07-29T11:55:00Z'), hostBackoffUntil: null, now, minIntervalMs: min }))
      .toEqual({ skip: true, reason: 'min-interval' });
  });
  test('polled 20 min ago, no backoff → ok', () => {
    expect(hostGate({ hostLastCheckedAt: new Date('2026-07-29T11:40:00Z'), hostBackoffUntil: null, now, minIntervalMs: min }))
      .toEqual({ skip: false, reason: 'ok' });
  });
  test('never polled, expired backoff → ok', () => {
    expect(hostGate({ hostLastCheckedAt: null, hostBackoffUntil: new Date('2026-07-29T11:00:00Z'), now, minIntervalMs: min }))
      .toEqual({ skip: false, reason: 'ok' });
  });

  // ── Precedence & boundary tests ─────────────────────────────────────────
  test('backoff in future + recent poll (would min-interval) → skip:backoff (precedence)', () => {
    expect(hostGate({
      hostLastCheckedAt: new Date('2026-07-29T11:55:00Z'), // 5 min ago, within min-interval
      hostBackoffUntil: new Date('2026-07-29T12:30:00Z'), // 30 min in future
      now,
      minIntervalMs: min,
    }))
      .toEqual({ skip: true, reason: 'backoff' });
  });

  test('hostBackoffUntil === now (expired at boundary) → ok (strict >)', () => {
    expect(hostGate({
      hostLastCheckedAt: null,
      hostBackoffUntil: now, // exactly now, not in future
      now,
      minIntervalMs: min,
    }))
      .toEqual({ skip: false, reason: 'ok' });
  });

  test('now - hostLastCheckedAt === minIntervalMs exactly (at boundary) → ok (strict <)', () => {
    const exactlyMinAgo = new Date(now.getTime() - min);
    expect(hostGate({
      hostLastCheckedAt: exactlyMinAgo, // exactly 15 min ago
      hostBackoffUntil: null,
      now,
      minIntervalMs: min,
    }))
      .toEqual({ skip: false, reason: 'ok' });
  });
});

describe('pollAllSources — time budget + rotation (WP-41)', () => {
  const NOW = new Date('2026-07-30T12:00:00Z');
  const FEED = (h: string) => `https://${h}/rss`;

  /** Ports whose fetches advance a shared fake clock, so the budget guard sees elapsed time. */
  function timedPorts(args: {
    sources: PollableSource[];
    plainMs?: number;
    renderMs?: number;
    withRenderer?: boolean;
  }): PollPorts & {
    loadActiveSources: () => Promise<PollableSource[]>;
    applied: PollEffects[];
    clock: () => number;
    plainFetches: number;
    renderFetches: number;
  } {
    const applied: PollEffects[] = [];
    const state = { t: 0, plainFetches: 0, renderFetches: 0 };
    const feed = RSS(ITEM('g1', 'https://x.example/c1'));
    const ports = {
      applied,
      clock: () => state.t,
      get plainFetches() {
        return state.plainFetches;
      },
      get renderFetches() {
        return state.renderFetches;
      },
      fetch: async () => {
        state.plainFetches++;
        state.t += args.plainMs ?? 0;
        return ok(feed);
      },
      loadActiveSources: async () => args.sources,
      loadStoredChapters: async () => [],
      applyPollEffects: async (e: PollEffects) => {
        applied.push(e);
      },
    } as PollPorts & {
      loadActiveSources: () => Promise<PollableSource[]>;
      applied: PollEffects[];
      clock: () => number;
      plainFetches: number;
      renderFetches: number;
    };
    if (args.withRenderer) {
      ports.renderFetch = async () => {
        state.renderFetches++;
        state.t += args.renderMs ?? 0;
        return ok(feed);
      };
    }
    return ports;
  }

  test('stops starting group fetches once the budget cannot cover the next one', async () => {
    // Three distinct plain feeds, each fetch "costs" PLAIN_COST_MS; budget fits exactly two.
    const s = [0, 1, 2].map((i) =>
      source({ id: `s${i}`, seriesId: `ser${i}`, host: `h${i}.example`, fetchUrl: FEED(`h${i}.example`) }),
    );
    const p = timedPorts({ sources: s, plainMs: PLAIN_COST_MS });

    await pollAllSources(p, NOW, { budgetMs: 2 * PLAIN_COST_MS, clock: p.clock });

    expect(p.plainFetches).toBe(2); // third group never fetched — over budget
    expect(p.applied.map((e) => e.seriesId)).toEqual(['ser0', 'ser1']);
  });

  test('an unaffordable RENDER group is skipped but a later affordable PLAIN still polls', async () => {
    // Render is estimated at 15s, plain at 5s; a 10s budget can't fit the render but can fit the plain.
    const render = source({ id: 'r', seriesId: 'serR', host: 'r.example', fetchUrl: FEED('r.example'), fetchMode: 'RENDER' });
    const plain = source({ id: 'p', seriesId: 'serP', host: 'p.example', fetchUrl: FEED('p.example'), fetchMode: 'PLAIN' });
    const p = timedPorts({ sources: [render, plain], plainMs: PLAIN_COST_MS, renderMs: RENDER_COST_MS, withRenderer: true });

    await pollAllSources(p, NOW, { budgetMs: 2 * PLAIN_COST_MS, clock: p.clock });

    expect(p.renderFetches).toBe(0); // render skipped (didn't fit)
    expect(p.plainFetches).toBe(1); // loop continued past it to the affordable plain
    expect(p.applied.map((e) => e.seriesId)).toEqual(['serP']);
  });

  test('rotation: the least-recently-polled host is polled first under a tight budget', async () => {
    // One host polled 20 min ago (>15 min floor, so not gated), one never polled. Budget fits one.
    const stale = source({ id: 'a', seriesId: 'serStale', host: 'a.example', fetchUrl: FEED('a.example'), lastCheckedAt: null });
    const fresh = source({
      id: 'b',
      seriesId: 'serFresh',
      host: 'b.example',
      fetchUrl: FEED('b.example'),
      lastCheckedAt: new Date(NOW.getTime() - 20 * 60_000),
    });
    // Input order puts the fresher one FIRST, to prove ordering (not input order) picks the winner.
    const p = timedPorts({ sources: [fresh, stale], plainMs: PLAIN_COST_MS });

    await pollAllSources(p, NOW, { budgetMs: PLAIN_COST_MS, clock: p.clock });

    expect(p.plainFetches).toBe(1);
    expect(p.applied.map((e) => e.seriesId)).toEqual(['serStale']); // never-polled drained first
  });

  test('with the default (ample) budget every group is polled', async () => {
    const s = [0, 1, 2].map((i) =>
      source({ id: `s${i}`, seriesId: `ser${i}`, host: `h${i}.example`, fetchUrl: FEED(`h${i}.example`) }),
    );
    const p = timedPorts({ sources: s, plainMs: PLAIN_COST_MS });

    await pollAllSources(p, NOW); // no opts → POLL_BUDGET_MS, real Date.now (elapsed ~0)

    expect(p.plainFetches).toBe(3);
    expect(POLL_BUDGET_MS).toBeGreaterThan(3 * PLAIN_COST_MS);
  });
});

describe('groupCostMs', () => {
  const grp = (over: Partial<PollGroup> = {}): PollGroup => ({
    key: 'k',
    fetchMode: 'PLAIN',
    fetchUrl: 'https://x.example/feed',
    host: 'x.example',
    sources: [],
    ...over,
  });

  test('a PLAIN group costs the plain estimate', () => {
    expect(groupCostMs(grp({ fetchMode: 'PLAIN' }), true)).toBe(PLAIN_COST_MS);
  });

  test('a RENDER group with a renderer configured costs the render estimate', () => {
    expect(groupCostMs(grp({ fetchMode: 'RENDER' }), true)).toBe(RENDER_COST_MS);
  });

  test('a RENDER group with NO renderer falls back to plain cost (it fetches plain)', () => {
    expect(groupCostMs(grp({ fetchMode: 'RENDER' }), false)).toBe(PLAIN_COST_MS);
  });

  test('render is estimated as more expensive than plain', () => {
    expect(RENDER_COST_MS).toBeGreaterThan(PLAIN_COST_MS);
  });
});

describe('orderGroupsByStaleness', () => {
  const groupsFor = (hosts: string[]): PollGroup[] =>
    hosts.map((h, i) =>
      groupPollSources([source({ id: `s${i}`, host: h, fetchUrl: `https://${h}/feed` })])[0]!,
    );

  test('a never-polled host (no entry) sorts before a polled one', () => {
    const [never, polled] = groupsFor(['never.example', 'polled.example']);
    const hostLast = new Map<string, Date | null>([
      ['polled.example', new Date('2026-07-30T10:00:00Z')],
      // never.example intentionally absent
    ]);
    expect(orderGroupsByStaleness([polled!, never!], hostLast).map((g) => g.host)).toEqual([
      'never.example',
      'polled.example',
    ]);
  });

  test('an explicit null lastChecked sorts before a polled one', () => {
    const [a, b] = groupsFor(['a.example', 'b.example']);
    const hostLast = new Map<string, Date | null>([
      ['a.example', new Date('2026-07-30T10:00:00Z')],
      ['b.example', null],
    ]);
    expect(orderGroupsByStaleness([a!, b!], hostLast).map((g) => g.host)).toEqual(['b.example', 'a.example']);
  });

  test('the least-recently-polled host sorts first (stalest drains first)', () => {
    const [old, mid, fresh] = groupsFor(['old.example', 'mid.example', 'fresh.example']);
    const hostLast = new Map<string, Date | null>([
      ['old.example', new Date('2026-07-30T08:00:00Z')],
      ['mid.example', new Date('2026-07-30T10:00:00Z')],
      ['fresh.example', new Date('2026-07-30T11:00:00Z')],
    ]);
    expect(orderGroupsByStaleness([fresh!, mid!, old!], hostLast).map((g) => g.host)).toEqual([
      'old.example',
      'mid.example',
      'fresh.example',
    ]);
  });

  test('ties keep input order (stable)', () => {
    const [a, b] = groupsFor(['a.example', 'b.example']);
    const t = new Date('2026-07-30T10:00:00Z');
    const hostLast = new Map<string, Date | null>([
      ['a.example', t],
      ['b.example', t],
    ]);
    expect(orderGroupsByStaleness([a!, b!], hostLast).map((g) => g.host)).toEqual(['a.example', 'b.example']);
  });
});

describe('sourceTierWhere', () => {
  test("'all' → every active source (the daily full superset)", () => {
    expect(sourceTierWhere('all')).toEqual({ isActive: true });
  });

  test("'plain' → only the cheap 304-able FEED+PLAIN tier", () => {
    expect(sourceTierWhere('plain')).toEqual({ isActive: true, type: 'FEED', fetchMode: 'PLAIN' });
  });
});

describe('statusPollGate', () => {
  const now = new Date('2026-07-30T12:00:00Z');
  const week = 7 * 24 * 60 * 60_000;

  test('READING is always eligible (cadence 0), even just polled', () => {
    expect(statusPollGate({ status: 'READING', lastCheckedAt: now, now })).toEqual({ skip: false, reason: 'ok' });
  });

  test('COMPLETED / DROPPED / PAUSED never auto-poll → status-skip', () => {
    for (const status of ['COMPLETED', 'DROPPED', 'PAUSED'] as const) {
      expect(statusPollGate({ status, lastCheckedAt: null, now })).toEqual({ skip: true, reason: 'status-skip' });
    }
  });

  test('PLANNED never polled before → eligible', () => {
    expect(statusPollGate({ status: 'PLANNED', lastCheckedAt: null, now })).toEqual({ skip: false, reason: 'ok' });
  });

  test('PLANNED polled 3 days ago (< 7d) → status-cadence skip', () => {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
    expect(statusPollGate({ status: 'PLANNED', lastCheckedAt: threeDaysAgo, now })).toEqual({ skip: true, reason: 'status-cadence' });
  });

  test('PLANNED at exactly 7 days → eligible (boundary, strict <)', () => {
    const exactlyWeek = new Date(now.getTime() - week);
    expect(statusPollGate({ status: 'PLANNED', lastCheckedAt: exactlyWeek, now })).toEqual({ skip: false, reason: 'ok' });
  });
});

describe('POLLABLE_STATUSES', () => {
  test('derives to exactly the non-null-cadence statuses', () => {
    expect([...POLLABLE_STATUSES].sort()).toEqual(['PLANNED', 'READING']);
  });
});
