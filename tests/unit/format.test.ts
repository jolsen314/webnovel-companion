import { describe, expect, test } from 'vitest';
import { relativeTime } from '../../src/lib/format';

const now = new Date('2026-07-21T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('relativeTime', () => {
  test.each([
    [ago(5 * SEC), 'just now'],
    [ago(3 * MIN), '3m ago'],
    [ago(2 * HOUR), '2h ago'],
    [ago(5 * DAY), '5d ago'],
    [ago(3 * 7 * DAY), '3w ago'],
    [ago(90 * DAY), '3mo ago'],
  ])('formats %s as %s', (from, expected) => {
    expect(relativeTime(from, now)).toBe(expected);
  });

  test('future or zero clamps to "just now"', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(new Date(now.getTime() + 10_000), now)).toBe('just now');
  });
});
