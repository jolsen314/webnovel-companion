'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeSchedule, type ReleaseEventKind, type ReleaseSchedule } from '../../../../lib/schedule';

/**
 * Manual release-schedule editor (WP-29) — the no-fetch fallback for blocked (link-only) sources.
 * A collapsible section (like Notes) that PATCHes a `releaseSchedule` onto the series; the cron's
 * `evaluateSchedules` then predicts releases and pushes the day after. Rendered only when the
 * active source is link-only (gated in the detail page), so it never double-notifies a series
 * that still fetches.
 */

type ScheduleKind = 'NONE' | 'INTERVAL' | 'WEEKLY';

/** Current server-side schedule, shaped for the form (anchor as a yyyy-mm-dd string). */
export interface ScheduleInit {
  kind: ScheduleKind;
  cadenceDays: number | null;
  anchoredOn: string | null;
  weekdays: number[];
  eventKind: ReleaseEventKind;
}

const WEEKDAYS: { d: number; label: string; name: string }[] = [
  { d: 0, label: 'S', name: 'Sunday' },
  { d: 1, label: 'M', name: 'Monday' },
  { d: 2, label: 'T', name: 'Tuesday' },
  { d: 3, label: 'W', name: 'Wednesday' },
  { d: 4, label: 'T', name: 'Thursday' },
  { d: 5, label: 'F', name: 'Friday' },
  { d: 6, label: 'S', name: 'Saturday' },
];

/** Build the pure `ReleaseSchedule` for the collapsed-preview summary, or null when unset. */
function toReleaseSchedule(init: ScheduleInit): ReleaseSchedule | null {
  if (init.kind === 'INTERVAL' && init.cadenceDays != null && init.anchoredOn != null) {
    return { kind: 'INTERVAL', cadenceDays: init.cadenceDays, anchoredOn: new Date(init.anchoredOn) };
  }
  if (init.kind === 'WEEKLY' && init.weekdays.length > 0) return { kind: 'WEEKLY', weekdays: init.weekdays };
  return null;
}

export function ScheduleEditor(props: { id: string; initial: ScheduleInit }) {
  const router = useRouter();
  const { initial } = props;
  const [open, setOpen] = useState(initial.kind !== 'NONE');
  const [kind, setKind] = useState<ScheduleKind>(initial.kind);
  const [cadenceDays, setCadenceDays] = useState(initial.cadenceDays != null ? String(initial.cadenceDays) : '');
  const [anchoredOn, setAnchoredOn] = useState(initial.anchoredOn ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(initial.weekdays);
  const [eventKind, setEventKind] = useState<ReleaseEventKind>(initial.eventKind);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const savedSchedule = toReleaseSchedule(initial);
  const preview = savedSchedule ? describeSchedule(savedSchedule, initial.eventKind) : null;

  const cadenceNum = Number(cadenceDays);
  const cadenceValid = Number.isInteger(cadenceNum) && cadenceNum >= 1 && cadenceNum <= 365;
  const canSave =
    !busy &&
    (kind === 'NONE' ||
      (kind === 'INTERVAL' && cadenceValid && anchoredOn.length > 0) ||
      (kind === 'WEEKLY' && weekdays.length > 0));

  function toggleWeekday(d: number) {
    setHint(null);
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  }

  function buildPayload() {
    if (kind === 'NONE') return { kind: 'NONE' as const };
    if (kind === 'INTERVAL') return { kind: 'INTERVAL' as const, cadenceDays: cadenceNum, anchoredOn, eventKind };
    return { kind: 'WEEKLY' as const, weekdays, eventKind };
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setHint('Saving…');
    try {
      const res = await fetch(`/api/series/${props.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ releaseSchedule: buildPayload() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHint('Saved');
      router.refresh();
    } catch {
      setHint('Could not save the schedule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notes">
      <button
        type="button"
        className="notes__toggle"
        aria-label="Release schedule"
        aria-expanded={open}
        aria-controls="release-schedule"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="notes__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="control__label">Release schedule</span>
        {!open && preview && <span className="notes__preview">{preview}</span>}
      </button>

      {open && (
        <div id="release-schedule" className="schedule__body">
          <p className="schedule__help">
            No chapters are fetched for a link-only source. Set a predicted release schedule and you’ll be notified the
            day after each expected release.
          </p>

          <label className="control">
            <span className="control__label">Schedule</span>
            <select
              value={kind}
              disabled={busy}
              aria-label="Schedule kind"
              onChange={(e) => {
                setKind(e.target.value as ScheduleKind);
                setHint(null);
              }}
            >
              <option value="NONE">None</option>
              <option value="INTERVAL">Every N days</option>
              <option value="WEEKLY">Weekly</option>
            </select>
          </label>

          {kind === 'INTERVAL' && (
            <div className="schedule__interval">
              <span className="control__label">Every</span>
              <input
                type="number"
                className="schedule__num"
                min={1}
                max={365}
                value={cadenceDays}
                disabled={busy}
                aria-label="Cadence in days"
                onChange={(e) => {
                  setCadenceDays(e.target.value);
                  setHint(null);
                }}
              />
              <span className="control__label">days, from a recent release</span>
              <input
                type="date"
                value={anchoredOn}
                disabled={busy}
                aria-label="A recent release date"
                onChange={(e) => {
                  setAnchoredOn(e.target.value);
                  setHint(null);
                }}
              />
            </div>
          )}

          {kind === 'WEEKLY' && (
            <div className="control">
              <span className="control__label">On</span>
              <div className="segmented" role="group" aria-label="Release weekdays">
                {WEEKDAYS.map(({ d, label, name }) => (
                  <button
                    key={d}
                    type="button"
                    className="segmented__option"
                    aria-pressed={weekdays.includes(d)}
                    aria-label={name}
                    disabled={busy}
                    onClick={() => toggleWeekday(d)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind !== 'NONE' && (
            <label className="control">
              <span className="control__label">Predicts</span>
              <select
                value={eventKind}
                disabled={busy}
                aria-label="Prediction kind"
                onChange={(e) => {
                  setEventKind(e.target.value as ReleaseEventKind);
                  setHint(null);
                }}
              >
                <option value="NEW_CHAPTER">New chapter</option>
                <option value="UNLOCKED">Now free (advance unlocks)</option>
              </select>
            </label>
          )}

          <div className="schedule__actions">
            <button type="button" className="control__action" disabled={!canSave} onClick={() => void save()}>
              Save schedule
            </button>
            {hint && (
              <span className="control__hint" role="status">
                {hint}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
