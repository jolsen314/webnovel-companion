import { describe, expect, test } from 'vitest';
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
  pollSource,
  RENDER_COST_MS,
  type PollableSource,
  type PollEffects,
  type PollGroup,
  type PollPorts,
} from '../../../src/server/services/poll';
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
    host: 'x.example',
    lastCheckedAt: null,
    backoffUntil: null,
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
    stored?: Record<string, KnownChapter[]>;
  }): PollPorts & { loadActiveSources: () => Promise<PollableSource[]>; applied: PollEffects[] } {
    const applied: PollEffects[] = [];
    return {
      applied,
      fetch: args.fetch,
      loadActiveSources: async () => args.sources,
      loadStoredChapters: async (seriesId) => args.stored?.[seriesId] ?? [],
      applyPollEffects: async (e) => {
        applied.push(e);
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
