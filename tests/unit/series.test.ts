import { describe, expect, test } from 'vitest';
import { SERIES_STATUSES } from '../../src/lib/series';

describe('SERIES_STATUSES', () => {
  test('is the canonical shelf-status set, matching the Prisma SeriesStatus enum', () => {
    expect([...SERIES_STATUSES]).toEqual(['READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED']);
  });
});
