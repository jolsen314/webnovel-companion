import { describe, expect, test } from 'vitest';
import {
  evaluateSchedules,
  type SchedulePorts,
  type ScheduledSeries,
  type ScheduleEffect,
} from '../../../src/server/services/scheduleNotify';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// July 2026: 6=Mon, 13=Mon, 14=Tue.

function ports(series: ScheduledSeries[]): SchedulePorts & { applied: ScheduleEffect[][] } {
  const applied: ScheduleEffect[][] = [];
  return {
    applied,
    loadScheduledSeries: async () => series,
    applyScheduleEffects: async (e) => {
      applied.push(e);
    },
  };
}

describe('evaluateSchedules', () => {
  test('emits a due-release effect (with event kind) and stamps only the due series', async () => {
    const p = ports([
      { seriesId: 'due1', schedule: { kind: 'WEEKLY', weekdays: [1] }, lastNotifiedAt: null, eventKind: 'UNLOCKED' },
      {
        seriesId: 'future',
        schedule: { kind: 'INTERVAL', cadenceDays: 7, anchoredOn: day('2026-08-01') },
        lastNotifiedAt: null,
        eventKind: 'NEW_CHAPTER',
      },
    ]);
    // now = Tue Jul 14 → Monday Jul 13 is due for due1; 'future' anchor hasn't cleared the buffer.
    const effects = await evaluateSchedules(p, new Date('2026-07-14T09:00:00Z'));

    expect(effects).toEqual([{ seriesId: 'due1', releaseDate: day('2026-07-13'), eventKind: 'UNLOCKED' }]);
    expect(p.applied).toEqual([[{ seriesId: 'due1', releaseDate: day('2026-07-13'), eventKind: 'UNLOCKED' }]]);
  });

  test('stamps every due series together when several clear the buffer at once', async () => {
    const p = ports([
      { seriesId: 'a', schedule: { kind: 'WEEKLY', weekdays: [1] }, lastNotifiedAt: null, eventKind: 'NEW_CHAPTER' },
      {
        seriesId: 'b',
        schedule: { kind: 'INTERVAL', cadenceDays: 7, anchoredOn: day('2026-07-06') },
        lastNotifiedAt: null,
        eventKind: 'UNLOCKED',
      },
      {
        seriesId: 'future',
        schedule: { kind: 'INTERVAL', cadenceDays: 7, anchoredOn: day('2026-08-01') },
        lastNotifiedAt: null,
        eventKind: 'NEW_CHAPTER',
      },
    ]);
    // now = Tue Jul 14 → both a (Mon Jul 13) and b (Jul 6 + 7 = Jul 13) are due; future is not.
    const effects = await evaluateSchedules(p, new Date('2026-07-14T09:00:00Z'));

    const expected: ScheduleEffect[] = [
      { seriesId: 'a', releaseDate: day('2026-07-13'), eventKind: 'NEW_CHAPTER' },
      { seriesId: 'b', releaseDate: day('2026-07-13'), eventKind: 'UNLOCKED' },
    ];
    expect(effects).toEqual(expected);
    expect(p.applied).toEqual([expected]);
  });

  test('nothing due → no effects and no stamping transaction', async () => {
    const p = ports([
      {
        seriesId: 'future',
        schedule: { kind: 'INTERVAL', cadenceDays: 7, anchoredOn: day('2026-08-01') },
        lastNotifiedAt: null,
        eventKind: 'NEW_CHAPTER',
      },
    ]);
    const effects = await evaluateSchedules(p, new Date('2026-07-14T09:00:00Z'));

    expect(effects).toEqual([]);
    expect(p.applied).toEqual([]);
  });
});
