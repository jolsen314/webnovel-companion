import { describe, expect, test } from 'vitest';
import { buildFeed, countNewSince, type FeedEvent, type DownSource } from '../../src/lib/feed';

const ev = (over: { at: string } & Partial<Omit<FeedEvent, 'at'>>): FeedEvent => ({
  kind: 'NEW_CHAPTER',
  seriesId: 's1',
  seriesTitle: 'Alpha',
  chapterNumber: 1,
  chapterTitle: 'Ch',
  chapterUrl: `https://ex.test/${over.at}`,
  read: false,
  ...over,
  at: new Date(over.at),
});

const NOW = new Date('2026-08-30T12:00:00Z');

describe('buildFeed', () => {
  test('orders newest-first and groups by UTC day with Today/Yesterday/date labels', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-28T09:00:00Z', chapterTitle: 'older' }),
          ev({ at: '2026-08-30T01:00:00Z', chapterTitle: 'today-early' }),
          ev({ at: '2026-08-30T08:00:00Z', chapterTitle: 'today-late' }),
          ev({ at: '2026-08-29T20:00:00Z', chapterTitle: 'yesterday' }),
        ],
        downSources: [],
      },
      NOW,
    );
    expect(feed.groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Fri, Aug 28']);
    expect(feed.groups[0]!.items.map((i) => i.chapterTitle)).toEqual(['today-late', 'today-early']);
    expect(feed.groups[1]!.items.map((i) => i.chapterTitle)).toEqual(['yesterday']);
  });

  test('orders mixed event kinds newest-first (two distinct chapters)', () => {
    // buildFeed is agnostic — it orders whatever events it's given. The
    // no-double-notify rule (a single chapter never produces both kinds) is
    // enforced upstream in getFeed, so these are two DIFFERENT chapters.
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-20T00:00:00Z', kind: 'NEW_CHAPTER', chapterUrl: 'https://ex.test/c8' }),
          ev({ at: '2026-08-30T00:00:00Z', kind: 'NOW_FREE', chapterUrl: 'https://ex.test/c9' }),
        ],
        downSources: [],
      },
      NOW,
    );
    const kinds = feed.groups.flatMap((g) => g.items.map((i) => i.kind));
    expect(kinds).toEqual(['NOW_FREE', 'NEW_CHAPTER']);
  });

  test('passes down sources through as attention, sorted by series title', () => {
    const down: DownSource[] = [
      { seriesId: 'b', seriesTitle: 'Beta', host: 'b.test', sourceUrl: 'https://b.test' },
      { seriesId: 'a', seriesTitle: 'Alpha', host: 'a.test', sourceUrl: 'https://a.test' },
    ];
    const feed = buildFeed({ events: [], downSources: down }, NOW);
    expect(feed.attention.map((d) => d.seriesTitle)).toEqual(['Alpha', 'Beta']);
    expect(feed.groups).toEqual([]);
  });

  test('same-timestamp events order by higher chapter number first (newest-first intent)', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-30T03:00:00Z', chapterNumber: 3, chapterTitle: 'lower' }),
          ev({ at: '2026-08-30T03:00:00Z', chapterNumber: 7, chapterTitle: 'higher' }),
        ],
        downSources: [],
      },
      NOW,
    );
    expect(feed.groups.flatMap((g) => g.items.map((i) => i.chapterTitle))).toEqual(['higher', 'lower']);
  });

  test('limit caps to the newest N; a same-timestamp tie keeps the higher (newer) chapter number', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-30T05:00:00Z', chapterNumber: 9, chapterUrl: 'https://ex.test/newest' }),
          // Two events share a timestamp; the higher chapter number (newer) must win the cap.
          ev({ at: '2026-08-30T03:00:00Z', chapterNumber: 3, chapterUrl: 'https://ex.test/lo' }),
          ev({ at: '2026-08-30T03:00:00Z', chapterNumber: 7, chapterUrl: 'https://ex.test/hi' }),
        ],
        downSources: [],
      },
      NOW,
      2,
    );
    const nums = feed.groups.flatMap((g) => g.items.map((i) => i.chapterNumber));
    // newest by time (9), then of the two time-tied the higher number (7) survives; 3 is dropped.
    expect(nums).toEqual([9, 7]);
  });

  test('no limit → keeps every event', () => {
    const feed = buildFeed(
      { events: [ev({ at: '2026-08-30T05:00:00Z' }), ev({ at: '2026-08-30T03:00:00Z' })], downSources: [] },
      NOW,
    );
    expect(feed.groups.flatMap((g) => g.items)).toHaveLength(2);
  });

  test('pure: does not mutate inputs', () => {
    const events = [ev({ at: '2026-08-30T00:00:00Z' }), ev({ at: '2026-08-29T00:00:00Z' })];
    const before = events.map((e) => e.chapterUrl);
    buildFeed({ events, downSources: [] }, NOW);
    expect(events.map((e) => e.chapterUrl)).toEqual(before);
  });
});

describe('countNewSince', () => {
  test('null watermark → 0 (first visit shows no divider)', () => {
    const feed = buildFeed({ events: [ev({ at: '2026-08-30T00:00:00Z' })], downSources: [] }, NOW);
    expect(countNewSince(feed, null)).toBe(0);
  });

  test('counts events strictly newer than the watermark', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-30T05:00:00Z' }),
          ev({ at: '2026-08-30T03:00:00Z' }),
          ev({ at: '2026-08-29T00:00:00Z' }),
        ],
        downSources: [],
      },
      NOW,
    );
    expect(countNewSince(feed, new Date('2026-08-30T02:00:00Z'))).toBe(2);
  });
});
