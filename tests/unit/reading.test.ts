import { describe, expect, test } from 'vitest';
import { unreadCount } from '../../src/lib/reading';

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
