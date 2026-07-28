import { describe, expect, test } from 'vitest';
import { unreadCount, orderChaptersForReading, arrangeChapters } from '../../src/lib/reading';

describe('unreadCount', () => {
  const chapters = ['a', 'b', 'c', 'd'];

  test('no progress → everything is unread', () => {
    expect(unreadCount(chapters, null)).toBe(4);
    expect(unreadCount(chapters, undefined)).toBe(4);
  });

  test('counts chapters after the last-read one', () => {
    expect(unreadCount(chapters, 'a')).toBe(3);
    expect(unreadCount(chapters, 'c')).toBe(1);
    expect(unreadCount(chapters, 'd')).toBe(0);
  });

  test('empty shelf is zero', () => {
    expect(unreadCount([], null)).toBe(0);
  });

  test('a stale last-read id (not among current chapters) falls back to all-unread', () => {
    expect(unreadCount(chapters, 'gone')).toBe(4);
  });
});

const ch = (over: Partial<{ id: string; number: number | null; title: string; position: number | null; publishedAt: Date | null; discoveredAt: Date }>) => ({
  id: 'x', number: null, title: 't', position: null, publishedAt: null, discoveredAt: new Date('2026-01-01T00:00:00Z'), ...over,
});

describe('orderChaptersForReading', () => {
  const urls = (cs: { id: string }[]) => cs.map((c) => c.id);

  test('numbered chapters sort ascending by number', () => {
    const out = orderChaptersForReading([ch({ id: '2', number: 2 }), ch({ id: '1', number: 1 }), ch({ id: '3', number: 3 })]);
    expect(urls(out)).toEqual(['1', '2', '3']);
  });

  test('an un-numbered prologue sorts to the front', () => {
    const out = orderChaptersForReading([ch({ id: 'c1', number: 1 }), ch({ id: 'p', number: null, title: 'Chapter α' })]);
    expect(urls(out)).toEqual(['p', 'c1']);
  });

  test('Extra / Side content sorts to the end even if un-numbered', () => {
    const out = orderChaptersForReading([
      ch({ id: 'extra', number: null, title: 'Extra: afterword' }),
      ch({ id: 'c1', number: 1 }),
      ch({ id: 'side', number: null, title: 'Side Story' }),
      ch({ id: 'prologue', number: null, title: 'Prologue' }),
    ]);
    expect(urls(out)).toEqual(['prologue', 'c1', 'extra', 'side']); // prologue front, main, then extras/side last
  });

  test('numbered Side Story chapters sort by number within the end bucket', () => {
    const out = orderChaptersForReading([
      ch({ id: 's2', number: 2, title: 'Side Story 2' }),
      ch({ id: 'c1', number: 1, title: 'Chapter 1' }),
      ch({ id: 's1', number: 1, title: 'Side Story 1' }),
    ]);
    expect(urls(out)).toEqual(['c1', 's1', 's2']); // main first, then side stories in their own number order
  });

  test('false-positive guard: "extraordinary" / "beside" are NOT treated as extra/side', () => {
    const out = orderChaptersForReading([
      ch({ id: 'c2', number: 2, title: 'An Extraordinary Beside-the-Point Battle' }),
      ch({ id: 'c1', number: 1, title: 'Chapter 1' }),
    ]);
    expect(urls(out)).toEqual(['c1', 'c2']); // stays in the main sequence
  });

  test('does not mutate its input', () => {
    const input = [ch({ id: '2', number: 2 }), ch({ id: '1', number: 1 })];
    orderChaptersForReading(input);
    expect(input.map((c) => c.id)).toEqual(['2', '1']);
  });
});

describe('orderChaptersForReading — position-aware (WP-35)', () => {
  const ch = (over: Partial<{ id: string; number: number | null; title: string; position: number | null; publishedAt: Date | null; discoveredAt: Date }>) => ({
    id: 'x', number: null, title: 't', position: null, publishedAt: null, discoveredAt: new Date('2026-01-01T00:00:00Z'), ...over,
  });

  test('positioned chapters sort by position (overriding the number comparator)', () => {
    const out = orderChaptersForReading([ch({ id: 'b', position: 1, number: 99 }), ch({ id: 'a', position: 0, number: 1 })]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });

  test('null-position chapters sort AFTER positioned ones, by the number comparator among themselves', () => {
    const out = orderChaptersForReading([
      ch({ id: 'new2', position: null, number: 6 }),
      ch({ id: 'p0', position: 0, number: 1 }),
      ch({ id: 'new1', position: null, number: 5 }),
    ]);
    expect(out.map((c) => c.id)).toEqual(['p0', 'new1', 'new2']); // positioned first, then nulls by number
  });

  test('all-null (pure-feed) falls back to the existing comparator behavior', () => {
    const out = orderChaptersForReading([ch({ id: '2', number: 2 }), ch({ id: '1', number: 1 })]);
    expect(out.map((c) => c.id)).toEqual(['1', '2']);
  });
});

describe('arrangeChapters', () => {
  const cs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]; // canonical oldest→newest
  test('oldest: identity order, read = up to and including the pointer', () => {
    const out = arrangeChapters(cs, 'b', 'oldest');
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.map((c) => c.read)).toEqual([true, true, false, false]);
  });
  test('newest: reversed, read flags follow the same chapters', () => {
    const out = arrangeChapters(cs, 'b', 'newest');
    expect(out.map((c) => c.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(out.find((c) => c.id === 'a')!.read).toBe(true);
    expect(out.find((c) => c.id === 'c')!.read).toBe(false);
  });
  test('unread: [unread asc] then [read asc]', () => {
    const out = arrangeChapters(cs, 'b', 'unread');
    expect(out.map((c) => c.id)).toEqual(['c', 'd', 'a', 'b']);
  });
  test('no/stale pointer → everything unread', () => {
    expect(arrangeChapters(cs, null, 'oldest').every((c) => !c.read)).toBe(true);
    expect(arrangeChapters(cs, 'zzz', 'oldest').every((c) => !c.read)).toBe(true);
  });
});
