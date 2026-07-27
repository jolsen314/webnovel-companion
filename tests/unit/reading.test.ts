import { describe, expect, test } from 'vitest';
import { unreadCount, orderChaptersForReading } from '../../src/lib/reading';

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

const ch = (over: Partial<{ id: string; number: number | null; title: string; publishedAt: Date | null; discoveredAt: Date }>) => ({
  id: 'x', number: null, title: 't', publishedAt: null, discoveredAt: new Date('2026-01-01T00:00:00Z'), ...over,
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
