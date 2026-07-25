import { describe, expect, test } from 'vitest';
import { nextDueRelease, type ScheduleState } from '../../src/lib/schedule';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// July 2026 weekday reference: 13=Mon, 14=Tue, 15=Wed, 16=Thu, 17=Fri, 18=Sat, 19=Sun.

describe('nextDueRelease — INTERVAL', () => {
  const weekly = (last: Date | null): ScheduleState => ({
    schedule: { kind: 'INTERVAL', cadenceDays: 7, anchoredOn: day('2026-07-01') }, // Jul 1,8,15,22…
    lastNotifiedAt: last,
  });

  test('returns the most recent predicted release once its day-after has arrived', () => {
    expect(nextDueRelease(weekly(null), new Date('2026-07-16T09:00:00Z'))).toEqual(day('2026-07-15'));
  });

  test('withholds a release on its own day — only notifies the day after', () => {
    // now = Jul 15 (the release day). Jul 15 is withheld; Jul 8 was already notified → nothing due.
    expect(nextDueRelease(weekly(day('2026-07-08')), new Date('2026-07-15T23:00:00Z'))).toBeNull();
  });

  test('fires on the day after, then de-dupes against lastNotifiedAt', () => {
    expect(nextDueRelease(weekly(day('2026-07-08')), new Date('2026-07-16T00:00:00Z'))).toEqual(day('2026-07-15'));
  });

  test('does not re-fire a release already notified', () => {
    expect(nextDueRelease(weekly(day('2026-07-15')), new Date('2026-07-20T09:00:00Z'))).toBeNull();
  });

  test('an anchor still in the future yields nothing', () => {
    const future: ScheduleState = {
      schedule: { kind: 'INTERVAL', cadenceDays: 7, anchoredOn: day('2026-08-01') },
      lastNotifiedAt: null,
    };
    expect(nextDueRelease(future, new Date('2026-07-16T09:00:00Z'))).toBeNull();
  });

  test('a non-positive cadence is inert', () => {
    const bad: ScheduleState = {
      schedule: { kind: 'INTERVAL', cadenceDays: 0, anchoredOn: day('2026-07-01') },
      lastNotifiedAt: null,
    };
    expect(nextDueRelease(bad, new Date('2026-07-16T09:00:00Z'))).toBeNull();
  });
});

describe('nextDueRelease — WEEKLY', () => {
  test('single weekday: notifies the day after that weekday', () => {
    // Monday-only; now = Tue Jul 14 → most recent Monday (Jul 13) is due.
    const state: ScheduleState = { schedule: { kind: 'WEEKLY', weekdays: [1] }, lastNotifiedAt: null };
    expect(nextDueRelease(state, new Date('2026-07-14T09:00:00Z'))).toEqual(day('2026-07-13'));
  });

  test('MWF pattern: picks the most recent matching weekday past the buffer', () => {
    // M/W/F; now = Thu Jul 16 → most recent match on/before Wed Jul 15 is Jul 15 (Wed).
    const state: ScheduleState = { schedule: { kind: 'WEEKLY', weekdays: [1, 3, 5] }, lastNotifiedAt: null };
    expect(nextDueRelease(state, new Date('2026-07-16T09:00:00Z'))).toEqual(day('2026-07-15'));
  });

  test('de-dupes a weekly release already notified', () => {
    const state: ScheduleState = { schedule: { kind: 'WEEKLY', weekdays: [3] }, lastNotifiedAt: day('2026-07-15') };
    expect(nextDueRelease(state, new Date('2026-07-16T09:00:00Z'))).toBeNull();
  });

  test('empty weekday set is inert', () => {
    const state: ScheduleState = { schedule: { kind: 'WEEKLY', weekdays: [] }, lastNotifiedAt: null };
    expect(nextDueRelease(state, new Date('2026-07-16T09:00:00Z'))).toBeNull();
  });
});

describe('nextDueRelease — no schedule', () => {
  test('a null schedule never fires', () => {
    expect(nextDueRelease({ schedule: null, lastNotifiedAt: null }, new Date('2026-07-16T09:00:00Z'))).toBeNull();
  });
});
