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
} as FeedEvent);

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

  test('keeps both event kinds (a locked→unlocked chapter yields two rows)', () => {
    const feed = buildFeed(
      {
        events: [
          ev({ at: '2026-08-20T00:00:00Z', kind: 'NEW_CHAPTER', chapterUrl: 'https://ex.test/c9' }),
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
