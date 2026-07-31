import { describe, expect, test } from 'vitest';
import {
  addSeries,
  pollAllSources,
  evaluateSchedules,
  notifyForEffects,
  getNotificationPrefs,
  updateNotificationPrefs,
  listSeries,
  getSeries,
  updateSeries,
  savePushSubscription,
  backfillFromToc,
  type FetchImpl,
} from '../../src/server/services';
import { db } from '../../src/server/db';
import { getCurrentUserId } from '../../src/server/user';
import type { PoliteResult } from '../../src/lib/feeds/fetch';
import type { PollEffects } from '../../src/server/services/poll';
import type { PushSendPorts, PushTarget } from '../../src/server/services/pushSend';
import type { PushMessage } from '../../src/lib/notify';

// ── fixtures ────────────────────────────────────────────────────────────────
const okRes = (body: string, extra: Partial<Extract<PoliteResult, { outcome: 'SUCCESS' }>> = {}): PoliteResult => ({
  outcome: 'SUCCESS',
  status: 200,
  notModified: false,
  body,
  etag: null,
  lastModified: null,
  finalUrl: 'https://x.example/',
  ...extra,
});
const PAGE = (feed: string) =>
  `<html><head><link rel="alternate" type="application/rss+xml" href="${feed}"></head><body></body></html>`;
const RSS = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Alpha</title>${items}</channel></rss>`;
const ITEM = (guid: string, url: string) => `<item><title>Chapter ${guid}</title><link>${url}</link><guid>${guid}</guid></item>`;
const fetchFrom =
  (map: Record<string, PoliteResult>): FetchImpl =>
  async (url) =>
    map[url] ?? ({ outcome: 'HTTP_4XX', status: 404 } as PoliteResult);

const PAGE_URL = 'https://translator.example/novel/alpha/';
const FEED_URL = 'https://translator.example/feed/';
const C1 = 'https://translator.example/a-1/';
const C2 = 'https://translator.example/a-2/';
const C3 = 'https://translator.example/a-3/';

/** Add the "Alpha" series (page → feed with 2 chapters) and return its id. */
async function addAlpha(): Promise<string> {
  const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
  const { seriesId } = await addSeries({ url: PAGE_URL }, fetch);
  return seriesId;
}

// ── tests ───────────────────────────────────────────────────────────────────
describe('addSeries (real DB)', () => {
  test('creates Series + Source + Chapters from a discovered feed', async () => {
    const seriesId = await addAlpha();

    const series = await db.series.findUnique({ where: { id: seriesId }, include: { sources: true, chapters: true } });
    expect(series).not.toBeNull();
    expect(series!.sources).toHaveLength(1);
    expect(series!.sources[0]!.feedUrl).toBe(FEED_URL);
    expect(series!.sources[0]!.host).toBe('translator.example');
    expect(series!.chapters.map((c) => c.guid).sort()).toEqual(['g1', 'g2']);
  });

  test('WP-33: a feed series seeds its full TOC history at add, with TOC access', async () => {
    // Page advertises the feed AND lists the full chapter history (feed shows only a-1,a-2; TOC adds a-3 locked).
    const PAGE_HTML =
      `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED_URL}"></head>` +
      `<body><ul>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li class="premium"><a href="${C3}">Chapter 3</a></li>` +
      `</ul></body></html>`;
    const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE_HTML), [FEED_URL]: okRes(RSS(ITEM('g1', C1) + ITEM('g2', C2))) });
    const { seriesId } = await addSeries({ url: PAGE_URL }, fetch);

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([C1, C2, C3]); // a-3 backfilled from the TOC
    expect(chapters.find((c) => c.url === C3)!.access).toBe('LOCKED');
    expect(chapters.find((c) => c.url === C1)!.guid).toBe('g1'); // overlap kept the feed guid
  });

  test('WP-39: re-adding the same series returns the existing one, no second row', async () => {
    const fetch = fetchFrom({ [PAGE_URL]: okRes(PAGE(FEED_URL)), [FEED_URL]: okRes(RSS(ITEM('g1', C1))) });
    const first = await addSeries({ url: PAGE_URL }, fetch);
    const second = await addSeries({ url: PAGE_URL }, fetch);

    expect(first.alreadyExisting).toBe(false);
    expect(second.alreadyExisting).toBe(true);
    expect(second.seriesId).toBe(first.seriesId);
    expect(await db.series.count()).toBe(1);
    expect((await db.series.findFirstOrThrow()).canonicalId).toBe('translator.example/feed#WHOLE_FEED');
  });
});

describe('listSeries (real DB)', () => {
  test('returns the series with unread = chapter count when unread, plus latest chapter', async () => {
    await addAlpha();
    const list = await listSeries();

    expect(list).toHaveLength(1);
    expect(list[0]!.chapterCount).toBe(2);
    expect(list[0]!.unread).toBe(2);
    expect(list[0]!.latestChapter?.url).toBe(C2);
    expect(list[0]!.activeSource?.host).toBe('translator.example');
  });
});

describe('pollAllSources (real DB)', () => {
  test('detects and persists a new chapter, stays HEALTHY, stores the etag', async () => {
    const seriesId = await addAlpha();

    const pollFetch = fetchFrom({
      [FEED_URL]: okRes(RSS(ITEM('g3', C3) + ITEM('g2', C2) + ITEM('g1', C1)), { etag: '"v2"' }),
    });
    const effects = await pollAllSources(pollFetch);

    expect(effects).toHaveLength(1);
    expect(effects[0]!.newChapters.map((c) => c.guid)).toEqual(['g3']);

    const chapters = await db.chapter.findMany({ where: { seriesId } });
    expect(chapters.map((c) => c.guid).sort()).toEqual(['g1', 'g2', 'g3']);
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.etag).toBe('"v2"');
    expect(source.health).toBe('HEALTHY');
    expect(source.lastSuccessAt).not.toBeNull();
  });

  test('304 not-modified adds nothing new', async () => {
    const seriesId = await addAlpha();
    const notMod: PoliteResult = { outcome: 'SUCCESS', status: 304, notModified: true, body: '', etag: null, lastModified: null, finalUrl: FEED_URL };

    const effects = await pollAllSources(async () => notMod);

    expect(effects[0]!.newChapters).toEqual([]);
    expect(await db.chapter.count({ where: { seriesId } })).toBe(2);
  });

  test('a DNS failure escalates health and records the failure type', async () => {
    const seriesId = await addAlpha();

    await pollAllSources(async () => ({ outcome: 'DNS' }));

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.health).toBe('DEGRADED');
    expect(source.failureScore).toBeGreaterThan(0);
    expect(source.lastFailureType).toBe('DNS');
  });
});

describe('pollAllSources dedup + politeness (real DB)', () => {
  const HUB_FEED = 'https://hub.example/feed/';
  const HUB_A1 = 'https://hub.example/novel-a/chapter-1/';
  const HUB_B1 = 'https://hub.example/novel-b/chapter-1/';

  /** A series bound to the shared HUB_FEED, isolated by a PATH_PREFIX match — the multi-novel
   *  case where several series share one site-wide feed. */
  async function addHubSeries(title: string, pathPrefix: string): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title } });
    await db.source.create({
      data: {
        seriesId: series.id,
        url: HUB_FEED,
        host: 'hub.example',
        type: 'FEED',
        fetchMode: 'PLAIN',
        feedUrl: HUB_FEED,
        matchType: 'PATH_PREFIX',
        matchValue: pathPrefix,
      },
    });
    return series.id;
  }

  test('two series sharing one feed are fetched once and both advance', async () => {
    const seriesA = await addHubSeries('Novel A', '/novel-a/');
    const seriesB = await addHubSeries('Novel B', '/novel-b/');

    let fetches = 0;
    const fetch: FetchImpl = async (url) => {
      if (url === HUB_FEED) fetches++;
      return okRes(RSS(ITEM('ga1', HUB_A1) + ITEM('gb1', HUB_B1)));
    };

    const effects = await pollAllSources(fetch);

    expect(fetches).toBe(1); // one feed URL, fetched once for both series
    expect(effects).toHaveLength(2);

    const chaptersA = await db.chapter.findMany({ where: { seriesId: seriesA } });
    const chaptersB = await db.chapter.findMany({ where: { seriesId: seriesB } });
    expect(chaptersA.map((c) => c.guid)).toEqual(['ga1']);
    expect(chaptersB.map((c) => c.guid)).toEqual(['gb1']);
  });

  test('a host polled less than 15 minutes ago is skipped by the min-interval gate', async () => {
    const seriesId = await addAlpha();
    const now = new Date('2026-01-01T00:20:00.000Z');
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    await db.source.updateMany({ where: { seriesId }, data: { lastCheckedAt: fiveMinAgo } });

    let fetches = 0;
    const fetch: FetchImpl = async (url) => {
      if (url === FEED_URL) fetches++;
      return okRes(RSS(ITEM('g3', C3) + ITEM('g2', C2) + ITEM('g1', C1)));
    };

    const effects = await pollAllSources(fetch, undefined, now);

    expect(fetches).toBe(0); // gated before the fetch — min-interval not yet elapsed
    expect(effects).toEqual([]);

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.lastCheckedAt?.getTime()).toBe(fiveMinAgo.getTime()); // untouched
    expect(source.lastSuccessAt).toBeNull();
    expect(await db.chapter.count({ where: { seriesId } })).toBe(2); // no new chapters
  });

  test('a successful poll clears a stale (expired) backoffUntil', async () => {
    const seriesId = await addAlpha();
    const now = new Date('2026-01-01T00:20:00.000Z');
    const expiredBackoff = new Date(now.getTime() - 60_000); // in the past — gate must NOT skip
    await db.source.updateMany({ where: { seriesId }, data: { backoffUntil: expiredBackoff } });

    await pollAllSources(
      fetchFrom({ [FEED_URL]: okRes(RSS(ITEM('g2', C2) + ITEM('g1', C1))) }),
      undefined,
      now,
    );

    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    expect(source.backoffUntil).toBeNull(); // a healthy poll clears stale backoff
  });
});

describe('page-watch source (real DB)', () => {
  const WATCH_URL = 'https://reader.example/series/omega/';
  const W1 = 'https://reader.example/series/omega/chapter-1/';
  const W2 = 'https://reader.example/series/omega/chapter-2/';
  const W3 = 'https://reader.example/series/omega/chapter-3/';
  const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
  const ROW = (url: string, locked = false) =>
    `<li${locked ? ' class="premium"' : ''}><a href="${url}">Chapter</a></li>`;

  test('adds a PAGE_WATCH source seeded from the TOC, with FREE/LOCKED access', async () => {
    // No feed anywhere (all guesses 404) → page-watch; the page IS the TOC.
    const fetch = fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) });
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetch);

    const series = await db.series.findUniqueOrThrow({
      where: { id: seriesId },
      include: { sources: true, chapters: { orderBy: { url: 'asc' } } },
    });
    expect(series.sources[0]!.type).toBe('PAGE_WATCH');
    expect(series.sources[0]!.feedUrl).toBeNull();
    expect(series.chapters.map((c) => c.url)).toEqual([W1, W2]);
    expect(series.chapters.map((c) => c.access)).toEqual(['FREE', 'LOCKED']);
  });

  test('poll parses the TOC, persists only the new chapter with its access, no storm on re-poll', async () => {
    const fetch = fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) });
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetch);

    // A third (locked) chapter appears; the first two are unchanged.
    const effects = await pollAllSources(
      fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true) + ROW(W3, true))) }),
    );

    expect(effects).toHaveLength(1);
    expect(effects[0]!.newChapters.map((c) => c.url)).toEqual([W3]);

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([W1, W2, W3]);
    expect(chapters.find((c) => c.url === W3)!.access).toBe('LOCKED');
  });

  test('a plain page-watch that under-reads escalates the source to RENDER (when a renderer is available)', async () => {
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }));
    // A tiny plain TOC (1 chapter ≤ 5) + a renderer available → persist fetchMode = RENDER for next time.
    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }), async () => okRes(TOC(ROW(W1))));

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('RENDER');
  });

  test('the same under-read does not escalate when no renderer is configured', async () => {
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }));
    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) })); // no render impl

    expect((await db.source.findFirstOrThrow({ where: { seriesId } })).fetchMode).toBe('PLAIN');
  });

  test('WP-20: a stored LOCKED chapter turning FREE stamps becameFreeAt and does not re-fire', async () => {
    // Add with W1 free, W2 locked.
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2, true))) }));

    // Next poll: W2 is now free. Pass an explicit `now` since the host min-interval gate (WP-42)
    // compares against the previous poll's persisted `lastCheckedAt` — the second call below needs
    // to land more than MIN_POLL_INTERVAL_MINUTES later, not just microseconds after this one.
    const t0 = new Date('2026-07-29T12:00:00Z');
    const effects = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }), undefined, t0);
    expect(effects[0]!.becameFree.map((c) => c.url)).toEqual([W2]);
    expect(effects[0]!.newChapters).toEqual([]);

    const w2 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W2 } });
    expect(w2.access).toBe('FREE');
    expect(w2.becameFreeAt).not.toBeNull();

    // A subsequent identical poll, well past the min-interval floor, must not re-detect it
    // (already FREE in storage).
    const t1 = new Date(t0.getTime() + 20 * 60_000); // 20 min later, past the 15-min floor
    const again = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }), undefined, t1);
    expect(again[0]!.becameFree).toEqual([]);
  });

  test('WP-33: a page-watch poll reconciles a stored UNKNOWN chapter to LOCKED, silently', async () => {
    const { seriesId } = await addSeries({ url: WATCH_URL }, fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1))) }));
    // Force the seeded chapter to UNKNOWN (simulate a feed-originated row).
    await db.chapter.updateMany({ where: { seriesId }, data: { access: 'UNKNOWN' } });

    await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1, true))) })); // now marked locked

    const w1 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W1 } });
    expect(w1.access).toBe('LOCKED');
    expect(w1.becameFreeAt).toBeNull(); // reconcile is silent — not an unlock
  });
});

describe('updateSeries (real DB)', () => {
  test('updates shelf fields, sets finishedAt, and records reading progress', async () => {
    const seriesId = await addAlpha();
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { discoveredAt: 'asc' } });

    const result = await updateSeries(seriesId, { status: 'COMPLETED', rating: 5, lastReadChapterId: chapters[0]!.id });
    expect(result).not.toBeNull();

    const series = await db.series.findUniqueOrThrow({ where: { id: seriesId }, include: { progress: true } });
    expect(series.status).toBe('COMPLETED');
    expect(series.rating).toBe(5);
    expect(series.finishedAt).not.toBeNull();
    expect(series.progress?.lastReadChapterId).toBe(chapters[0]!.id);

    const list = await listSeries();
    expect(list[0]!.unread).toBe(1); // one chapter after the last-read one
  });

  test('returns null for a series that is not the current user’s', async () => {
    expect(await updateSeries('nonexistent-id', { status: 'DROPPED' })).toBeNull();
  });
});

describe('evaluateSchedules (real DB)', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  test('fires a due scheduled release, stamps it, and does not re-fire on the next run', async () => {
    const seriesId = await addAlpha();
    await db.series.update({
      where: { id: seriesId },
      data: { releaseScheduleKind: 'WEEKLY', releaseWeekdays: [1], releaseEventKind: 'UNLOCKED' },
    });

    // now = Tue Jul 14 → Monday Jul 13 release is due.
    const now = new Date('2026-07-14T09:00:00Z');
    const effects = await evaluateSchedules(now);
    expect(effects).toEqual([{ seriesId, releaseDate: day('2026-07-13'), eventKind: 'UNLOCKED' }]);

    const after = await db.series.findUniqueOrThrow({ where: { id: seriesId } });
    expect(after.scheduleLastNotifiedAt).toEqual(day('2026-07-13'));

    expect(await evaluateSchedules(now)).toEqual([]); // already stamped → no double-fire
  });

  test('a series without a schedule is ignored', async () => {
    await addAlpha();
    expect(await evaluateSchedules(new Date('2026-07-14T09:00:00Z'))).toEqual([]);
  });
});

describe('notifyForEffects (real DB)', () => {
  const HEALTHY = { health: 'HEALTHY', consecutiveFailures: 0, score: 0, lastFailureType: null } as const;
  const effect = (over: Partial<PollEffects>): PollEffects => ({
    sourceId: 'src',
    seriesId: 'series',
    seriesStatus: 'READING',
    health: HEALTHY,
    succeeded: true,
    notModified: false,
    newChapters: [],
    becameFree: [],
    accessReconciled: [],
    etag: null,
    lastModified: null,
    crossedDown: false,
    escalateToRender: false,
    ...over,
  });

  test('builds per-series digest + scheduled messages with real titles', async () => {
    const seriesId = await addAlpha(); // series title "Alpha"
    const captured: PushMessage[] = [];
    const ports: PushSendPorts = {
      loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
      send: async (_t, m) => {
        captured.push(m);
        return 'SENT';
      },
      deleteSubscription: async () => {},
    };

    const summary = await notifyForEffects(
      [effect({ seriesId, newChapters: [{ url: 'u1', title: 'C1' }, { url: 'u2', title: 'C2' }] })],
      [{ seriesId, releaseDate: new Date('2026-07-13T00:00:00Z'), eventKind: 'UNLOCKED' }],
      ports,
    );

    expect(captured.map((m) => ({ title: m.title, body: m.body, tag: m.tag }))).toEqual([
      { title: 'New chapters', body: 'Alpha — 2 new', tag: `new-${seriesId}` },
      { title: 'Likely now free', body: 'Alpha', tag: `sched-${seriesId}` },
    ]);
    expect(summary.sent).toBe(2);
  });

  const captureAll = (): { ports: PushSendPorts; captured: PushMessage[] } => {
    const captured: PushMessage[] = [];
    return {
      captured,
      ports: {
        loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
        send: async (_t, m) => {
          captured.push(m);
          return 'SENT';
        },
        deleteSubscription: async () => {},
      },
    };
  };

  test('a source crossing down produces a "may be down" alert (when source-down push is on)', async () => {
    const seriesId = await addAlpha();
    await updateNotificationPrefs({ pushSourceDown: true }); // default is off — opt in
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ sourceId: source.id, seriesId, crossedDown: true })], [], ports);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.body).toBe(`Alpha — ${source.host} isn't responding`);
    expect(captured[0]!.tag).toBe(`down-${seriesId}`);
  });

  test('by default, source-down is in-app only — no push', async () => {
    const seriesId = await addAlpha();
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ sourceId: source.id, seriesId, crossedDown: true })], [], ports);

    expect(captured).toEqual([]); // pushSourceDown defaults off
  });

  test('an EXPIRED push channel (404/410) is pruned — independent of source health', async () => {
    const seriesId = await addAlpha();
    await db.pushSubscription.create({ data: { userId: 'local', endpoint: 'gone', p256dh: 'p', auth: 'a' } });
    const ports: PushSendPorts = {
      loadSubscriptions: async () =>
        db.pushSubscription.findMany({ select: { endpoint: true, p256dh: true, auth: true } }) as Promise<PushTarget[]>,
      send: async () => 'EXPIRED', // the push service says this device's channel is gone
      deleteSubscription: async (endpoint) => {
        await db.pushSubscription.delete({ where: { endpoint } });
      },
    };

    // A plain new-chapter effect (source is HEALTHY) — pruning has nothing to do with the site.
    const summary = await notifyForEffects([effect({ seriesId, newChapters: [{ url: 'u', title: 'C' }] })], [], ports);

    expect(summary.expired).toBe(1);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  test('WP-20: becameFree → a "Now free" push; a locked-only new chapter is not pushed', async () => {
    const seriesId = await addAlpha(); // title "Alpha"
    const { ports, captured } = captureAll();

    await notifyForEffects(
      [
        effect({
          seriesId,
          becameFree: [{ url: 'u-unlocked', access: 'FREE' }],
          newChapters: [{ url: 'u-locked', title: 'C3', access: 'LOCKED' }],
        }),
      ],
      [],
      ports,
    );

    // Only the unlock is pushed; the new *locked* chapter is stored-silently (no new-chapter push).
    expect(captured.map((m) => ({ title: m.title, body: m.body, tag: m.tag }))).toEqual([
      { title: 'Now free', body: 'Alpha', tag: `free-${seriesId}` },
    ]);
  });

  test('WP-20: a new FREE chapter still pushes as a normal new chapter', async () => {
    const seriesId = await addAlpha();
    const { ports, captured } = captureAll();

    await notifyForEffects([effect({ seriesId, newChapters: [{ url: 'u', title: 'C', access: 'FREE' }] })], [], ports);

    expect(captured.map((m) => m.title)).toEqual(['New chapter']);
  });

  test('WP-27a: a non-READING series does not push new chapters or now-free', async () => {
    const readingId = await addAlpha(); // status defaults READING
    const planned = await db.series.create({ data: { userId: getCurrentUserId(), title: 'Planned', status: 'PLANNED' } });
    const captured: PushMessage[] = [];
    const ports: PushSendPorts = {
      loadSubscriptions: async () => [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }],
      send: async (_t, m) => { captured.push(m); return 'SENT'; },
      deleteSubscription: async () => {},
    };

    await notifyForEffects(
      [
        effect({ seriesId: readingId, seriesStatus: 'READING', newChapters: [{ url: 'r1', title: 'R1', access: 'FREE' }] }),
        effect({ seriesId: planned.id, seriesStatus: 'PLANNED', newChapters: [{ url: 'p1', title: 'P1', access: 'FREE' }], becameFree: [{ url: 'p0', access: 'FREE' }] }),
      ],
      [],
      ports,
    );

    // Only the READING series produced a push; the PLANNED one is silent.
    expect(captured.map((m) => m.tag)).toEqual([`new-${readingId}`]);
  });
});

describe('notification preferences (real DB)', () => {
  test('defaults when unset: new + scheduled on, source-down off', async () => {
    expect(await getNotificationPrefs()).toEqual({ pushNewChapter: true, pushScheduled: true, pushSourceDown: false });
  });

  test('a partial update upserts and persists, leaving other toggles at their default', async () => {
    const updated = await updateNotificationPrefs({ pushSourceDown: true });
    expect(updated).toEqual({ pushNewChapter: true, pushScheduled: true, pushSourceDown: true });
    // a second partial update only touches its field
    await updateNotificationPrefs({ pushNewChapter: false });
    expect(await getNotificationPrefs()).toEqual({ pushNewChapter: false, pushScheduled: true, pushSourceDown: true });
  });
});

describe('backfillFromToc (real DB)', () => {
  const PAGE = 'https://translator.example/novel/alpha/';
  const B1 = 'https://translator.example/a-1/';
  const B2 = 'https://translator.example/a-2/';
  const B3 = 'https://translator.example/a-3/';
  const TOC = (rows: string) => `<html><body><ul>${rows}</ul></body></html>`;
  const ROW = (u: string, locked = false) => `<li${locked ? ' class="premium"' : ''}><a href="${u}">Chapter</a></li>`;

  test('adds older chapters missing from the feed window and reconciles access, without pushing', async () => {
    // addAlpha() seeds a FEED series with 2 chapters (a-1, a-2) as access UNKNOWN, source.url = the series page.
    const seriesId = await addAlpha();
    // Point the source's reading page at our TOC (which shows the full history a-1..a-3, a-2 locked).
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    const result = await backfillFromToc(
      seriesId,
      fetchFrom({ [PAGE]: okRes(TOC(ROW(B1) + ROW(B2, true) + ROW(B3))) }),
    );

    expect(result.added).toBe(1); // a-3 was missing
    expect(result.reconciled).toBe(2); // a-1 → FREE, a-2 → LOCKED (were UNKNOWN)

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.map((c) => c.url)).toEqual([B1, B2, B3]);
    expect(chapters.find((c) => c.url === B1)!.access).toBe('FREE');
    expect(chapters.find((c) => c.url === B2)!.access).toBe('LOCKED');
    expect(chapters.find((c) => c.url === B3)!.access).toBe('FREE');
    // a-1 went UNKNOWN → FREE via reconciliation, not an unlock — becameFreeAt must stay
    // null, since that's the field a real unlock stamps to trigger a "Now free" push (WP-20).
    // A set becameFreeAt here would mean this silent backfill created a push-worthy event.
    expect(chapters.find((c) => c.url === B1)!.becameFreeAt).toBeNull();
  });
});

describe('WP-35: chapter positions (real DB)', () => {
  const WATCH = 'https://reader.example/series/omega/';
  const rows = ['chapter-1', 'chapter-2', 'chapter-3']
    .map((s) => `<li><a href="${WATCH}${s}/">${s}</a></li>`)
    .join('');

  test('add seeds chapter positions from the TOC order', async () => {
    const { seriesId } = await addSeries(
      { url: WATCH },
      fetchFrom({ [WATCH]: okRes(`<html><body><ul>${rows}</ul></body></html>`) }),
    );
    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.find((c) => c.url.endsWith('chapter-1/'))!.position).toBe(0);
    expect(chapters.find((c) => c.url.endsWith('chapter-2/'))!.position).toBe(1);
    expect(chapters.find((c) => c.url.endsWith('chapter-3/'))!.position).toBe(2);
  });

  // getSeries/listSeries return chapters in position order (not number/date), for a positioned series.
  // Build the series with a position order that DIFFERS from number/discovery order to prove position wins:
  // direct db inserts, chapter "1" at position 2 (last) and chapter "3" at position 0 (first).
  test('getSeries and listSeries order by position', async () => {
    const { seriesId } = await addSeries({ url: WATCH }, fetchFrom({ [WATCH]: okRes('<html><body></body></html>') }));
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    await db.chapter.createMany({
      data: [
        { seriesId, sourceId: source.id, title: 'Chapter 1', url: `${WATCH}chapter-1/`, number: 1, position: 2 },
        { seriesId, sourceId: source.id, title: 'Chapter 2', url: `${WATCH}chapter-2/`, number: 2, position: 1 },
        { seriesId, sourceId: source.id, title: 'Chapter 3', url: `${WATCH}chapter-3/`, number: 3, position: 0 },
      ],
    });

    const series = await getSeries(seriesId);
    expect(series!.chapters.map((c) => c.url)).toEqual([`${WATCH}chapter-3/`, `${WATCH}chapter-2/`, `${WATCH}chapter-1/`]);

    const list = await listSeries();
    const entry = list.find((s) => s.id === seriesId)!;
    expect(entry.latestChapter?.url).toBe(`${WATCH}chapter-1/`); // last in position order = highest position
  });

  // backfillFromToc re-indexes positions of existing chapters + sets them on the newly-added tail.
  test('backfill assigns/re-indexes positions from the TOC', async () => {
    const seriesId = await addAlpha(); // feed series a-1, a-2, positions null
    const PAGE = 'https://translator.example/novel/alpha/';
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    // Descending TOC (newest-first, well-formed trend) with a-3 added as the oldest, so the resulting
    // reading-order position differs from insertion/number order and proves the re-index actually ran.
    const TOC =
      `<html><body><ul>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `</ul></body></html>`;
    const result = await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(TOC) }));
    expect(result.added).toBe(1); // a-3 was missing

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(chapters.find((c) => c.url === C1)!.position).toBe(0);
    expect(chapters.find((c) => c.url === C2)!.position).toBe(1);
    expect(chapters.find((c) => c.url === C3)!.position).toBe(2);
  });

  // A partial/windowed TOC (missing a chapter the store already has, e.g. a site trimming to its
  // recent window) must NOT re-index — that would collide the TOC-present chapters' fresh 0..N-1
  // block with the untouched position of the chapter the TOC dropped. Positions must stay as-is,
  // and any newly-discovered chapter must get position: null (sorts last = newest).
  test('backfill leaves positions untouched when the TOC is missing a stored chapter', async () => {
    const seriesId = await addAlpha(); // feed series a-1, a-2, positions null
    const PAGE = 'https://translator.example/novel/alpha/';
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    // Step 1: a full TOC (a-3, a-2, a-1, descending) backfills a-3 and re-indexes all three to
    // a-1=0, a-2=1, a-3=2 — same as the "re-indexes positions from the TOC" case above.
    const FULL_TOC =
      `<html><body><ul>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `</ul></body></html>`;
    await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(FULL_TOC) }));
    const afterFull = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    expect(afterFull.find((c) => c.url === C1)!.position).toBe(0);
    expect(afterFull.find((c) => c.url === C2)!.position).toBe(1);
    expect(afterFull.find((c) => c.url === C3)!.position).toBe(2);

    // Step 2: the site trims its TOC to a recent window that drops a-1 and adds a new a-4
    // (a-4, a-3, a-2, descending). a-1 is stored but absent from this TOC → partial → no re-index.
    const C4 = 'https://translator.example/a-4/';
    const PARTIAL_TOC =
      `<html><body><ul>` +
      `<li><a href="${C4}">Chapter 4</a></li>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `</ul></body></html>`;
    const result = await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(PARTIAL_TOC) }));
    expect(result.added).toBe(1); // a-4 was missing

    const afterPartial = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    // Existing chapters keep their step-1 positions — untouched, no collision.
    expect(afterPartial.find((c) => c.url === C1)!.position).toBe(0);
    expect(afterPartial.find((c) => c.url === C2)!.position).toBe(1);
    expect(afterPartial.find((c) => c.url === C3)!.position).toBe(2);
    // The newly-added chapter gets no position (sorts last = newest), not a colliding re-index.
    expect(afterPartial.find((c) => c.url === C4)!.position).toBeNull();
  });

  // A feed-ahead chapter (newest, published to the feed but not yet on the hand-maintained TOC
  // page) is stored with position: null. Unlike the windowed case above, it must NOT block the
  // re-index: it's unpositioned, so leaving it null (sorts last = newest) collides with nothing.
  // The TOC-covered chapters still get their positions. This is the dense-feed-source TCF case — Part 2's
  // newest chapter arrives via feed before the TOC index page lists it, leaving the whole series
  // unpositioned and falling back to the (two-part-colliding) number order.
  test('backfill re-indexes when the only absent-from-TOC chapter is unpositioned (feed-ahead)', async () => {
    const seriesId = await addAlpha(); // feed series a-1, a-2, positions null
    const PAGE = 'https://translator.example/novel/alpha/';
    await db.source.updateMany({ where: { seriesId }, data: { url: PAGE } });

    // A feed-ahead chapter: newest, stored (null position), and NOT on the TOC yet.
    const source = await db.source.findFirstOrThrow({ where: { seriesId } });
    const C9 = 'https://translator.example/a-9/';
    await db.chapter.create({
      data: { seriesId, sourceId: source.id, title: 'Chapter 9', url: C9, number: 9, position: null },
    });

    // Full-history TOC (a-3, a-2, a-1 descending): covers a-1/a-2, adds a-3, omits the feed-ahead a-9.
    const TOC =
      `<html><body><ul>` +
      `<li><a href="${C3}">Chapter 3</a></li>` +
      `<li><a href="${C2}">Chapter 2</a></li>` +
      `<li><a href="${C1}">Chapter 1</a></li>` +
      `</ul></body></html>`;
    const result = await backfillFromToc(seriesId, fetchFrom({ [PAGE]: okRes(TOC) }));
    expect(result.added).toBe(1); // a-3

    const chapters = await db.chapter.findMany({ where: { seriesId }, orderBy: { url: 'asc' } });
    // TOC-covered chapters get re-indexed — the feed-ahead a-9 did not block it.
    expect(chapters.find((c) => c.url === C1)!.position).toBe(0);
    expect(chapters.find((c) => c.url === C2)!.position).toBe(1);
    expect(chapters.find((c) => c.url === C3)!.position).toBe(2);
    // The feed-ahead chapter stays null → sorts last (newest).
    expect(chapters.find((c) => c.url === C9)!.position).toBeNull();
  });
});

describe('savePushSubscription (real DB)', () => {
  test('upserts by endpoint — re-subscribing updates keys, not row count', async () => {
    await savePushSubscription({ endpoint: 'https://push.example/e1', p256dh: 'p', auth: 'a' });
    await savePushSubscription({ endpoint: 'https://push.example/e1', p256dh: 'p2', auth: 'a2' });

    const subs = await db.pushSubscription.findMany();
    expect(subs).toHaveLength(1);
    expect(subs[0]!.p256dh).toBe('p2');
  });
});

describe('pollAllSources status gating (real DB, WP-27a)', () => {
  async function seedStatus(status: 'READING' | 'PLANNED' | 'PAUSED' | 'COMPLETED' | 'DROPPED', host: string, lastCheckedAt: Date | null): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title: status, status } });
    await db.source.create({
      data: { seriesId: series.id, url: `https://${host}/rss`, host, type: 'FEED', fetchMode: 'PLAIN', feedUrl: `https://${host}/rss`, matchType: 'WHOLE_FEED', lastCheckedAt },
    });
    return series.id;
  }

  test('COMPLETED / DROPPED / PAUSED are never polled', async () => {
    const ids = {
      completed: await seedStatus('COMPLETED', 'c.example', null),
      dropped: await seedStatus('DROPPED', 'd.example', null),
      paused: await seedStatus('PAUSED', 'pa.example', null),
    };
    const fetch = fetchFrom({}); // any fetch would 404; we assert none happen
    const effects = await pollAllSources(fetch);
    expect(effects).toEqual([]);
    for (const id of Object.values(ids)) {
      const src = await db.source.findFirstOrThrow({ where: { seriesId: id } });
      expect(src.lastCheckedAt).toBeNull();
    }
  });

  test('PLANNED is polled only when past its weekly window', async () => {
    const freshLastCheckedAt = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    const fresh = await seedStatus('PLANNED', 'fresh.example', freshLastCheckedAt);
    const stale = await seedStatus('PLANNED', 'stale.example', new Date(Date.now() - 8 * 24 * 60 * 60_000));
    const fetch = fetchFrom({ 'https://stale.example/rss': okRes(RSS('')), 'https://fresh.example/rss': okRes(RSS('')) });
    const effects = await pollAllSources(fetch);
    expect(effects.map((e) => e.seriesId)).toEqual([stale]);
    // Not due (< 7d cadence) → untouched, not stamped by this poll.
    expect((await db.source.findFirstOrThrow({ where: { seriesId: fresh } })).lastCheckedAt?.getTime()).toBe(
      freshLastCheckedAt.getTime(),
    );
  });

  test('a not-due PLANNED source riding a shared feed with a READING source is processed (ride-along)', async () => {
    const SHARED = 'https://shared-feed.example/rss';
    const reading = await db.series.create({ data: { userId: getCurrentUserId(), title: 'R-shared', status: 'READING' } });
    const planned = await db.series.create({ data: { userId: getCurrentUserId(), title: 'P-shared', status: 'PLANNED' } });
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60_000); // 2 days ago — well inside the weekly window (not due on its own)
    for (const [seriesId, lastCheckedAt] of [[reading.id, null], [planned.id, recent]] as const) {
      await db.source.create({
        data: { seriesId, url: SHARED, host: 'shared-feed.example', type: 'FEED', fetchMode: 'PLAIN', feedUrl: SHARED, matchType: 'WHOLE_FEED', lastCheckedAt },
      });
    }

    const effects = await pollAllSources(fetchFrom({ [SHARED]: okRes(RSS(ITEM('g1', 'https://shared-feed.example/c1'))) }));

    // The due READING source triggers the one shared fetch; the not-due PLANNED source rides along
    // (processed for free) rather than being left stale — both store the chapter.
    expect(effects.map((e) => e.seriesId).sort()).toEqual([planned.id, reading.id].sort());
    expect(await db.chapter.count({ where: { seriesId: reading.id } })).toBe(1);
    expect(await db.chapter.count({ where: { seriesId: planned.id } })).toBe(1);
    expect((await db.source.findFirstOrThrow({ where: { seriesId: planned.id } })).lastCheckedAt).not.toBeNull();
  });
});

describe('pollAllSources tier filter (real DB, WP-43)', () => {
  const PLAIN_FEED = 'https://plain.example/feed/';
  const RENDER_FEED = 'https://render.example/feed/';
  const WATCH_URL = 'https://watch.example/toc/';

  /** Seed one source of a given type/fetchMode bound to a fresh series. Returns the source id. */
  async function seedSource(args: {
    title: string;
    url: string;
    host: string;
    type: 'FEED' | 'PAGE_WATCH';
    fetchMode: 'PLAIN' | 'RENDER';
  }): Promise<string> {
    const series = await db.series.create({ data: { userId: getCurrentUserId(), title: args.title } });
    const source = await db.source.create({
      data: {
        seriesId: series.id,
        url: args.url,
        host: args.host,
        type: args.type,
        fetchMode: args.fetchMode,
        feedUrl: args.type === 'FEED' ? args.url : null,
        matchType: 'WHOLE_FEED',
      },
    });
    return source.id;
  }

  test("tier='plain' polls only FEED+PLAIN; RENDER and PAGE_WATCH are untouched", async () => {
    const plainId = await seedSource({ title: 'PlainFeed', url: PLAIN_FEED, host: 'plain.example', type: 'FEED', fetchMode: 'PLAIN' });
    const renderId = await seedSource({ title: 'RenderFeed', url: RENDER_FEED, host: 'render.example', type: 'FEED', fetchMode: 'RENDER' });
    const watchId = await seedSource({ title: 'PageWatch', url: WATCH_URL, host: 'watch.example', type: 'PAGE_WATCH', fetchMode: 'PLAIN' });

    // Fetch serves every url, so "not polled" can only be due to the tier filter, not a fetch miss.
    const fetch = fetchFrom({ [PLAIN_FEED]: okRes(RSS('')), [RENDER_FEED]: okRes(RSS('')), [WATCH_URL]: okRes('<html></html>') });
    const effects = await pollAllSources(fetch, undefined, undefined, 'plain');

    expect(effects.map((e) => e.sourceId)).toEqual([plainId]);
    // The excluded sources were never polled → lastCheckedAt stays null.
    expect((await db.source.findFirstOrThrow({ where: { id: renderId } })).lastCheckedAt).toBeNull();
    expect((await db.source.findFirstOrThrow({ where: { id: watchId } })).lastCheckedAt).toBeNull();
    expect((await db.source.findFirstOrThrow({ where: { id: plainId } })).lastCheckedAt).not.toBeNull();
  });

  test("tier='all' polls every active source (filter does not leak into the default path)", async () => {
    await seedSource({ title: 'PlainFeed', url: PLAIN_FEED, host: 'plain.example', type: 'FEED', fetchMode: 'PLAIN' });
    await seedSource({ title: 'RenderFeed', url: RENDER_FEED, host: 'render.example', type: 'FEED', fetchMode: 'RENDER' });
    await seedSource({ title: 'PageWatch', url: WATCH_URL, host: 'watch.example', type: 'PAGE_WATCH', fetchMode: 'PLAIN' });

    const fetch = fetchFrom({ [PLAIN_FEED]: okRes(RSS('')), [RENDER_FEED]: okRes(RSS('')), [WATCH_URL]: okRes('<html></html>') });
    const effects = await pollAllSources(fetch, undefined, undefined, 'all');

    expect(effects).toHaveLength(3);
  });
});
