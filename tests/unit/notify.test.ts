import { describe, expect, test } from 'vitest';
import { buildPushMessages, type NotifyInput } from '../../src/lib/notify';

const titles: Record<string, string> = { s1: 'Silver Moon Saga', s2: 'Cannon Fodder', s3: 'Hotel Business' };
const base = (over: Partial<NotifyInput>): NotifyInput => ({
  seriesTitle: (id) => titles[id] ?? 'A series',
  newChapters: [],
  sourcesDown: [],
  scheduledReleases: [],
  ...over,
});

describe('buildPushMessages', () => {
  test('new chapters → one per-series digest, pluralized, deep-linked', () => {
    const msgs = buildPushMessages(base({ newChapters: [{ seriesId: 's1', count: 3 }] }));
    expect(msgs).toEqual([
      { title: 'Silver Moon Saga', body: '3 new chapters', url: '/series/s1', tag: 'new-s1' },
    ]);
  });

  test('a single new chapter is not pluralized', () => {
    const msgs = buildPushMessages(base({ newChapters: [{ seriesId: 's2', count: 1 }] }));
    expect(msgs[0]!.body).toBe('1 new chapter');
  });

  test('a zero/negative count produces no message', () => {
    expect(buildPushMessages(base({ newChapters: [{ seriesId: 's1', count: 0 }] }))).toEqual([]);
  });

  test('scheduled releases use kind-specific copy', () => {
    const msgs = buildPushMessages(
      base({
        scheduledReleases: [
          { seriesId: 's1', eventKind: 'NEW_CHAPTER' },
          { seriesId: 's2', eventKind: 'UNLOCKED' },
        ],
      }),
    );
    expect(msgs).toEqual([
      { title: 'Silver Moon Saga', body: 'A new chapter is likely up', url: '/series/s1', tag: 'sched-s1' },
      { title: 'Cannon Fodder', body: 'An advance chapter likely went free', url: '/series/s2', tag: 'sched-s2' },
    ]);
  });

  test('a source going down is its own alert', () => {
    const msgs = buildPushMessages(base({ sourcesDown: [{ seriesId: 's3', host: 'reader.example' }] }));
    expect(msgs).toEqual([
      { title: 'Source may be down', body: "Hotel Business — reader.example isn't responding", url: '/series/s3', tag: 'down-s3' },
    ]);
  });

  test('within a category, messages preserve input order (no sorting)', () => {
    // Input is s2 then s1; a sort by id/title would flip them — output must not.
    const msgs = buildPushMessages(
      base({ newChapters: [{ seriesId: 's2', count: 1 }, { seriesId: 's1', count: 1 }] }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s2', 'new-s1']);
  });

  test('categories are emitted in a fixed priority order: new chapters → scheduled → down', () => {
    // Inputs are supplied down → scheduled → new to show the output order is the category
    // priority, not the order the categories were passed in.
    const msgs = buildPushMessages(
      base({
        sourcesDown: [{ seriesId: 's3', host: 'reader.example' }],
        scheduledReleases: [{ seriesId: 's2', eventKind: 'UNLOCKED' }],
        newChapters: [{ seriesId: 's1', count: 2 }],
      }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s1', 'sched-s2', 'down-s3']);
  });
});
