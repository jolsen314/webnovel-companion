import { describe, expect, test } from 'vitest';
import { chaptersToMove } from '../../../src/lib/chapters/merge';

describe('chaptersToMove', () => {
  test('returns from-chapters whose canonical URL is not already in into', () => {
    const from = [{ id: 'f1', url: 'https://x/a' }, { id: 'f2', url: 'https://x/b/' }];
    const into = ['https://x/b']; // canonically equal to b/
    expect(chaptersToMove(from, into).map((c) => c.id)).toEqual(['f1']);
  });

  test('canonical match ignores tracking params', () => {
    const from = [{ id: 'f1', url: 'https://x/a?utm_source=rss' }];
    expect(chaptersToMove(from, ['https://x/a'])).toEqual([]);
  });

  test('empty into → all from move', () => {
    const from = [{ id: 'f1', url: 'https://x/a' }];
    expect(chaptersToMove(from, [])).toHaveLength(1);
  });
});
