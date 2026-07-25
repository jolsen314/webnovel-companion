import { nextDueRelease, type ReleaseEventKind, type ReleaseSchedule } from '../../lib/schedule';

/**
 * Schedule evaluation: the no-fetch half of release tracking (WP-29). For each series
 * carrying a manual schedule, ask the pure `nextDueRelease` whether a predicted release
 * is due, emit an effect for the ones that are, and stamp them so they don't re-fire.
 * Composed behind injected ports (like `pollSource`) so the logic unit-tests with fakes
 * and binds to Prisma at the edge. Delivery of the effect is WP-09 (push).
 */

/** A series with a (non-null) schedule, as the evaluator needs it. */
export interface ScheduledSeries {
  seriesId: string;
  schedule: ReleaseSchedule;
  lastNotifiedAt: Date | null;
  eventKind: ReleaseEventKind;
}

/** A predicted release that came due on this run — handed to push (WP-09) and used to stamp. */
export interface ScheduleEffect {
  seriesId: string;
  releaseDate: Date;
  eventKind: ReleaseEventKind;
}

export interface SchedulePorts {
  loadScheduledSeries: () => Promise<ScheduledSeries[]>;
  /** Persist the stamp (`scheduleLastNotifiedAt = releaseDate`) for each due series. */
  applyScheduleEffects: (effects: ScheduleEffect[]) => Promise<void>;
}

export async function evaluateSchedules(ports: SchedulePorts, now: Date): Promise<ScheduleEffect[]> {
  const series = await ports.loadScheduledSeries();
  const effects: ScheduleEffect[] = [];
  for (const s of series) {
    const due = nextDueRelease({ schedule: s.schedule, lastNotifiedAt: s.lastNotifiedAt }, now);
    if (due) effects.push({ seriesId: s.seriesId, releaseDate: due, eventKind: s.eventKind });
  }
  if (effects.length > 0) await ports.applyScheduleEffects(effects);
  return effects;
}
