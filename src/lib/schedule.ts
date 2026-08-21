/**
 * Predicted release scheduling (pure). For sources we can't read (fully blocked),
 * the owner supplies an editable schedule and we notify the day *after* a predicted
 * release — time-of-day is unknown and tightness isn't needed. No clock, no I/O:
 * `now` is injected. Day math is UTC-based (epoch-day granularity) so it's DST-safe.
 */

export type ReleaseEventKind = 'NEW_CHAPTER' | 'UNLOCKED';

export type ReleaseSchedule =
  | { kind: 'INTERVAL'; cadenceDays: number; anchoredOn: Date }
  /** weekdays: 0 = Sun … 6 = Sat (e.g. MWF = [1, 3, 5]). */
  | { kind: 'WEEKLY'; weekdays: number[] };

export interface ScheduleState {
  schedule: ReleaseSchedule | null;
  lastNotifiedAt: Date | null;
}

/** Short weekday labels, indexed 0 = Sun … 6 = Sat (matches `weekdays`/`weekdayOf`). */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * A human one-liner for a schedule + its event kind (WP-29) — used for the editor's collapsed
 * preview. Pure and presentation-only. WEEKLY days are listed in week order regardless of input
 * order; INTERVAL reads "Every N days" (or "Every day" at cadence 1).
 */
export function describeSchedule(schedule: ReleaseSchedule, eventKind: ReleaseEventKind): string {
  const event = eventKind === 'UNLOCKED' ? 'now free' : 'new chapter';
  if (schedule.kind === 'INTERVAL') {
    const cadence = schedule.cadenceDays === 1 ? 'Every day' : `Every ${schedule.cadenceDays} days`;
    return `${cadence} · ${event}`;
  }
  const days = [...schedule.weekdays]
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d])
    .join(', ');
  return `${days} · ${event}`;
}

const MS_PER_DAY = 86_400_000;
const dayIndex = (d: Date): number => Math.floor(d.getTime() / MS_PER_DAY);
const dayToDate = (idx: number): Date => new Date(idx * MS_PER_DAY);
/** Weekday of an epoch-day index, 0 = Sun … 6 = Sat (epoch day 0 = Thursday). */
const weekdayOf = (idx: number): number => (((idx + 4) % 7) + 7) % 7;

/**
 * The predicted release date that is now due to notify, or null. "Due" = the most
 * recent predicted release whose day-after has arrived (`<= yesterday`) and that is
 * newer than `lastNotifiedAt`. The caller stamps `lastNotifiedAt` with the returned
 * date so the same release never re-fires.
 */
export function nextDueRelease(state: ScheduleState, now: Date): Date | null {
  const { schedule, lastNotifiedAt } = state;
  if (!schedule) return null;

  // Day-after buffer: a release only counts once we're at least a day past it.
  const cutoff = dayIndex(now) - 1;
  let release: number | null = null;

  if (schedule.kind === 'INTERVAL') {
    if (schedule.cadenceDays <= 0) return null;
    const anchor = dayIndex(schedule.anchoredOn);
    if (anchor > cutoff) return null; // no release has cleared the buffer yet
    const k = Math.floor((cutoff - anchor) / schedule.cadenceDays);
    release = anchor + k * schedule.cadenceDays;
  } else {
    const weekdays = new Set(schedule.weekdays.filter((d) => d >= 0 && d <= 6));
    if (weekdays.size === 0) return null;
    for (let i = 0; i < 7; i++) {
      if (weekdays.has(weekdayOf(cutoff - i))) {
        release = cutoff - i;
        break;
      }
    }
  }

  if (release === null) return null;
  if (lastNotifiedAt !== null && release <= dayIndex(lastNotifiedAt)) return null; // already notified
  return dayToDate(release);
}
