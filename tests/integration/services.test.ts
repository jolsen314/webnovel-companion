import { describe, expect, test } from 'vitest';
import {
  addSeries,
  pollAllSources,
  evaluateSchedules,
  notifyForEffects,
  getNotificationPrefs,
  updateNotificationPrefs,
  listSeries,
  updateSeries,
  savePushSubscription,
  backfillFromToc,
  type FetchImpl,
} from '../../src/server/services';
import { db } from '../../src/server/db';
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

    // Next poll: W2 is now free.
    const effects = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }));
    expect(effects[0]!.becameFree.map((c) => c.url)).toEqual([W2]);
    expect(effects[0]!.newChapters).toEqual([]);

    const w2 = await db.chapter.findFirstOrThrow({ where: { seriesId, url: W2 } });
    expect(w2.access).toBe('FREE');
    expect(w2.becameFreeAt).not.toBeNull();

    // A subsequent identical poll must not re-detect it (already FREE in storage).
    const again = await pollAllSources(fetchFrom({ [WATCH_URL]: okRes(TOC(ROW(W1) + ROW(W2))) }));
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
    expect(chapters.find((c) => c.url === B2)!.access).toBe('LOCKED');
    expect(chapters.find((c) => c.url === B3)!.access).toBe('FREE');
    // a-1 went UNKNOWN → FREE via reconciliation, not an unlock — becameFreeAt must stay
    // null, since that's the field a real unlock stamps to trigger a "Now free" push (WP-20).
    // A set becameFreeAt here would mean this silent backfill created a push-worthy event.
    expect(chapters.find((c) => c.url === B1)!.becameFreeAt).toBeNull();
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
