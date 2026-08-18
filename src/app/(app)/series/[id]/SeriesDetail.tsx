'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { arrangeChapters, type ChapterDisplayMode } from '../../../../lib/reading';
import { DeleteSeries } from './DeleteSeries';
import { SERIES_STATUSES, type SeriesStatus } from '../../../../lib/series';

const DISPLAY_MODES: { mode: ChapterDisplayMode; label: string }[] = [
  { mode: 'oldest', label: 'Oldest' },
  { mode: 'newest', label: 'Newest' },
  { mode: 'unread', label: 'Unread-first' },
];
const DISPLAY_MODE_STORAGE_KEY = 'chapterDisplayMode';

export interface ChapterLite {
  id: string;
  title: string;
  number: number | null;
  url: string;
}

export function SeriesDetail(props: {
  id: string;
  title: string;
  status: SeriesStatus;
  rating: number | null;
  chapters: ChapterLite[];
  lastReadChapterId: string | null;
  sourceType: 'FEED' | 'PAGE_WATCH' | 'API';
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SeriesStatus>(props.status);
  const [rating, setRating] = useState<number | null>(props.rating);
  const [lastRead, setLastRead] = useState<string | null>(props.lastReadChapterId);
  const [busy, setBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  // Initialized to 'oldest' to match the server render; the stored preference (if any) is
  // applied in an effect after mount, so there's no hydration mismatch.
  const [mode, setMode] = useState<ChapterDisplayMode>('oldest');

  useEffect(() => {
    const stored = window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    if (stored === 'oldest' || stored === 'newest' || stored === 'unread') setMode(stored);
  }, []);

  function chooseMode(next: ChapterDisplayMode) {
    setMode(next);
    window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, next);
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/series/${props.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  /** POST a source action, format its JSON into that action's hint, and refresh — or show
   *  `failMsg` on any non-2xx/parse/network failure. Shared by backfill + track-unlocks, which
   *  differ only in URL, result shape, hint copy, and which hint state they write. */
  async function postAction<T>(
    url: string,
    setMessage: (m: string | null) => void,
    format: (result: T) => string,
    failMsg: string,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(format((await res.json()) as T));
      router.refresh();
    } catch {
      setMessage(failMsg);
    } finally {
      setBusy(false);
    }
  }

  const backfill = () =>
    postAction<{ added: number; reconciled: number; rendered?: boolean }>(
      `/api/series/${props.id}/backfill`,
      setBackfillMessage,
      (r) => `Added ${r.added} · updated ${r.reconciled}${r.rendered ? ' · rendered' : ''}`,
      'Backfill failed',
    );

  const trackUnlocks = () =>
    postAction<{ added: number; fetchMode: string; rendered: boolean }>(
      `/api/series/${props.id}/switch`,
      setSwitchMessage,
      (r) => `Switched · ${r.added} chapters${r.rendered ? ' · rendered' : ''}`,
      'Switch failed',
    );

  const arranged = arrangeChapters(props.chapters, lastRead, mode);

  return (
    <>
      <div className="detail__controls">
        <label className="control">
          <span className="control__label">Status</span>
          <select
            value={status}
            disabled={busy}
            onChange={(e) => {
              const s = e.target.value as SeriesStatus;
              setStatus(s);
              void patch({ status: s });
            }}
          >
            {SERIES_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0] + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <div className="control">
          <span className="control__label">Rating</span>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star ${rating && n <= rating ? 'star--on' : ''}`}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                disabled={busy}
                onClick={() => {
                  setRating(n);
                  void patch({ rating: n });
                }}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <span className="control__label">Chapters</span>
          <button type="button" className="control__action" disabled={busy} onClick={() => void backfill()}>
            Backfill from TOC
          </button>
          {backfillMessage && (
            <span className="control__hint" role="status">
              {backfillMessage}
            </span>
          )}
        </div>

        {props.sourceType === 'FEED' && (
          <div className="control">
            <span className="control__label">Lock-monitoring</span>
            <button type="button" className="control__action" disabled={busy} onClick={() => void trackUnlocks()}>
              Track unlocks (switch to TOC)
            </button>
            {switchMessage && <span className="control__hint" role="status">{switchMessage}</span>}
          </div>
        )}

        <div className="control">
          <span className="control__label">Show</span>
          <div className="segmented" role="group" aria-label="Chapter display order">
            {DISPLAY_MODES.map(({ mode: m, label }) => (
              <button
                key={m}
                type="button"
                className="segmented__option"
                aria-pressed={mode === m}
                onClick={() => chooseMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <DeleteSeries id={props.id} title={props.title} chapterCount={props.chapters.length} />

      <ol className="chapters">
        {arranged.map((c) => (
          <li key={c.id} className={`chapter ${c.read ? 'chapter--read' : ''}`}>
            {c.number != null && <span className="chapter__num">#{c.number}</span>}
            <a className="chapter__title" href={c.url} target="_blank" rel="noreferrer">
              {c.title}
            </a>
            <button
              type="button"
              className="chapter__mark"
              disabled={busy}
              onClick={() => {
                setLastRead(c.id);
                void patch({ lastReadChapterId: c.id });
              }}
            >
              {lastRead === c.id ? 'current' : 'mark read'}
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}
