import { describe, expect, test } from 'vitest';
import { sortSeries, filterSeries, type ShelfSeries } from '../../src/lib/shelf';

const s = (over: Partial<ShelfSeries> & { id: string }): ShelfSeries & { id: string } => ({
  title: 'Title',
  unread: 0,
  rating: null,
  status: 'READING',
  latestChapter: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const at = (iso: string) => ({ at: new Date(iso) });

describe('sortSeries', () => {
  test('recent: newest latest-chapter first, no-chapter rows last', () => {
    const rows = [
      s({ id: 'old', latestChapter: at('2026-01-01T00:00:00Z') }),
      s({ id: 'none', latestChapter: null }),
      s({ id: 'new', latestChapter: at('2026-06-01T00:00:00Z') }),
    ];
    expect(sortSeries(rows, 'recent').map((r) => r.id)).toEqual(['new', 'old', 'none']);
  });

  test('recent: two no-chapter rows tie-break by title', () => {
    const rows = [s({ id: 'b', title: 'Beta' }), s({ id: 'a', title: 'Alpha' })];
    expect(sortSeries(rows, 'recent').map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('unread: most unread first, tie-break recent activity', () => {
    const rows = [
      s({ id: 'low', unread: 1, latestChapter: at('2026-06-01T00:00:00Z') }),
      s({ id: 'hiOld', unread: 5, latestChapter: at('2026-01-01T00:00:00Z') }),
      s({ id: 'hiNew', unread: 5, latestChapter: at('2026-05-01T00:00:00Z') }),
    ];
    expect(sortSeries(rows, 'unread').map((r) => r.id)).toEqual(['hiNew', 'hiOld', 'low']);
  });

  test('title: case-insensitive alphabetical', () => {
    const rows = [s({ id: 'z', title: 'zebra' }), s({ id: 'A', title: 'Apple' }), s({ id: 'b', title: 'banana' })];
    expect(sortSeries(rows, 'title').map((r) => r.id)).toEqual(['A', 'b', 'z']);
  });

  test('rating: highest first, unrated last, tie-break title', () => {
    const rows = [
      s({ id: 'unrated', rating: null }),
      s({ id: 'three', rating: 3 }),
      s({ id: 'fiveB', rating: 5, title: 'Beta' }),
      s({ id: 'fiveA', rating: 5, title: 'Alpha' }),
    ];
    expect(sortSeries(rows, 'rating').map((r) => r.id)).toEqual(['fiveA', 'fiveB', 'three', 'unrated']);
  });

  test('added: newest createdAt first, tie-break title', () => {
    const rows = [
      s({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }),
      s({ id: 'newB', title: 'Beta', createdAt: new Date('2026-06-01T00:00:00Z') }),
      s({ id: 'newA', title: 'Alpha', createdAt: new Date('2026-06-01T00:00:00Z') }),
    ];
    expect(sortSeries(rows, 'added').map((r) => r.id)).toEqual(['newA', 'newB', 'old']);
  });

  test('pure: does not mutate the input array', () => {
    const rows = [s({ id: 'b', title: 'B' }), s({ id: 'a', title: 'A' })];
    const before = rows.map((r) => r.id);
    sortSeries(rows, 'title');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('filterSeries', () => {
  const rows = [
    s({ id: 'reading', status: 'READING', title: 'Dragon King', rating: 5 }),
    s({ id: 'planned', status: 'PLANNED', title: 'Sword Saint', rating: 3 }),
    s({ id: 'paused', status: 'PAUSED', title: 'Dungeon Diver', rating: null }),
  ];

  test('ALL status returns everything', () => {
    expect(filterSeries(rows, { status: 'ALL', query: '', minRating: null })).toHaveLength(3);
  });

  test('status filters to an exact match', () => {
    expect(filterSeries(rows, { status: 'PLANNED', query: '', minRating: null }).map((r) => r.id)).toEqual(['planned']);
  });

  test('query is a case-insensitive substring on title', () => {
    // 'G' matches Dragon King + Dungeon Diver (not Sword Saint), and the uppercase query
    // matching lowercase glyphs proves case-insensitivity.
    expect(filterSeries(rows, { status: 'ALL', query: 'G', minRating: null }).map((r) => r.id)).toEqual([
      'reading',
      'paused',
    ]);
  });

  test('minRating keeps rating >= N and drops unrated', () => {
    expect(filterSeries(rows, { status: 'ALL', query: '', minRating: 4 }).map((r) => r.id)).toEqual(['reading']);
  });

  test('filters compose — only the intersection survives, no single filter alone', () => {
    // Each filter below individually returns 3 of the 4 rows; only their AND isolates 'target'.
    const composeRows = [
      s({ id: 'target', status: 'READING', title: 'Dragon King', rating: 5 }),
      s({ id: 'lowRating', status: 'READING', title: 'Dragon Lord', rating: 2 }), // fails minRating only
      s({ id: 'wrongStatus', status: 'PLANNED', title: 'Dragon Queen', rating: 5 }), // fails status only
      s({ id: 'noMatch', status: 'READING', title: 'Sword Saint', rating: 5 }), // fails query only
    ];
    // Sanity: each filter alone leaves 3 rows (so passing isn't an accident of one dimension).
    expect(filterSeries(composeRows, { status: 'READING', query: '', minRating: null })).toHaveLength(3);
    expect(filterSeries(composeRows, { status: 'ALL', query: 'dragon', minRating: null })).toHaveLength(3);
    expect(filterSeries(composeRows, { status: 'ALL', query: '', minRating: 4 })).toHaveLength(3);
    expect(
      filterSeries(composeRows, { status: 'READING', query: 'dragon', minRating: 4 }).map((r) => r.id),
    ).toEqual(['target']);
  });

  test('pure: does not mutate the input array', () => {
    const copy = [...rows];
    filterSeries(rows, { status: 'PLANNED', query: '', minRating: null });
    expect(rows).toEqual(copy);
  });
});
