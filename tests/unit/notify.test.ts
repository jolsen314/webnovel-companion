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
  test('new chapters → one per-series digest, deep-linked, work name kept out of the title', () => {
    const msgs = buildPushMessages(base({ newChapters: [{ seriesId: 's1', count: 3 }] }));
    expect(msgs).toEqual([
      { title: 'New chapters', body: 'Silver Moon Saga — 3 new', url: '/series/s1', tag: 'new-s1' },
    ]);
  });

  test('a single new chapter uses the singular title, with just the work name in the body', () => {
    const msgs = buildPushMessages(base({ newChapters: [{ seriesId: 's2', count: 1 }] }));
    expect(msgs[0]!.title).toBe('New chapter');
    expect(msgs[0]!.body).toBe('Cannon Fodder');
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
      { title: 'New chapter likely', body: 'Silver Moon Saga', url: '/series/s1', tag: 'sched-s1' },
      { title: 'Likely now free', body: 'Cannon Fodder', url: '/series/s2', tag: 'sched-s2' },
    ]);
  });

  test('a source going down is its own alert (title already work-agnostic)', () => {
    const msgs = buildPushMessages(base({ sourcesDown: [{ seriesId: 's3', host: 'reader.example' }] }));
    expect(msgs).toEqual([
      { title: 'Source may be down', body: "Hotel Business — reader.example isn't responding", url: '/series/s3', tag: 'down-s3' },
    ]);
  });

  test('privacy: the work title never appears in the always-visible notification title', () => {
    const msgs = buildPushMessages(
      base({
        newChapters: [{ seriesId: 's1', count: 2 }],
        scheduledReleases: [{ seriesId: 's1', eventKind: 'UNLOCKED' }],
      }),
    );
    for (const m of msgs) expect(m.title).not.toContain('Silver Moon Saga');
  });

  test('within a category, messages preserve input order (no sorting)', () => {
    // Input is s2 then s1; a sort by id/title would flip them — output must not.
    const msgs = buildPushMessages(
      base({ newChapters: [{ seriesId: 's2', count: 1 }, { seriesId: 's1', count: 1 }] }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s2', 'new-s1']);
  });

  test('per-type push preferences suppress disabled categories (in-app only)', () => {
    const msgs = buildPushMessages(
      base({
        newChapters: [{ seriesId: 's1', count: 2 }],
        scheduledReleases: [{ seriesId: 's2', eventKind: 'UNLOCKED' }],
        sourcesDown: [{ seriesId: 's3', host: 'reader.example' }],
        push: { newChapters: true, scheduledReleases: false, sourcesDown: false },
      }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s1']); // scheduled + down suppressed
  });

  test('omitting preferences enables every category (back-compat default)', () => {
    const msgs = buildPushMessages(
      base({ newChapters: [{ seriesId: 's1', count: 1 }], sourcesDown: [{ seriesId: 's3', host: 'h' }] }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s1', 'down-s3']);
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

describe('buildPushMessages — now free (WP-20)', () => {
  test('a single unlock: "Now free" title, work name only in the body', () => {
    const msgs = buildPushMessages(base({ nowFree: [{ seriesId: 's1', count: 1 }] }));
    expect(msgs).toEqual([
      { title: 'Now free', body: 'Silver Moon Saga', url: '/series/s1', tag: 'free-s1' },
    ]);
  });

  test('multiple unlocks digest the count in the body', () => {
    const msgs = buildPushMessages(base({ nowFree: [{ seriesId: 's2', count: 3 }] }));
    expect(msgs[0]!.body).toBe('Cannon Fodder — 3 now free');
  });

  test('a zero/negative count produces no now-free message', () => {
    expect(buildPushMessages(base({ nowFree: [{ seriesId: 's1', count: 0 }] }))).toEqual([]);
  });

  test('now-free rides the newChapters toggle — off suppresses it', () => {
    const msgs = buildPushMessages(
      base({ nowFree: [{ seriesId: 's1', count: 1 }], push: { newChapters: false, scheduledReleases: true, sourcesDown: true } }),
    );
    expect(msgs).toEqual([]);
  });

  test('privacy: the work title never appears in a now-free title', () => {
    const msgs = buildPushMessages(base({ nowFree: [{ seriesId: 's1', count: 2 }] }));
    for (const m of msgs) expect(m.title).not.toContain('Silver Moon Saga');
  });

  test('category order: new chapters → now free → scheduled → down', () => {
    const msgs = buildPushMessages(
      base({
        sourcesDown: [{ seriesId: 's3', host: 'reader.example' }],
        scheduledReleases: [{ seriesId: 's2', eventKind: 'UNLOCKED' }],
        nowFree: [{ seriesId: 's2', count: 1 }],
        newChapters: [{ seriesId: 's1', count: 2 }],
      }),
    );
    expect(msgs.map((m) => m.tag)).toEqual(['new-s1', 'free-s2', 'sched-s2', 'down-s3']);
  });
});
