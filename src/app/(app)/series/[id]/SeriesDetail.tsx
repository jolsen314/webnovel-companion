'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED'] as const;
type Status = (typeof STATUSES)[number];

export interface ChapterLite {
  id: string;
  title: string;
  number: number | null;
  url: string;
}

export function SeriesDetail(props: {
  id: string;
  status: Status;
  rating: number | null;
  chapters: ChapterLite[];
  lastReadChapterId: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(props.status);
  const [rating, setRating] = useState<number | null>(props.rating);
  const [lastRead, setLastRead] = useState<string | null>(props.lastReadChapterId);
  const [busy, setBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

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

  async function backfill() {
    setBusy(true);
    setBackfillMessage(null);
    try {
      const res = await fetch(`/api/series/${props.id}/backfill`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as { added: number; reconciled: number };
      setBackfillMessage(`Added ${result.added} · updated ${result.reconciled}`);
      router.refresh();
    } catch {
      setBackfillMessage('Backfill failed');
    } finally {
      setBusy(false);
    }
  }

  const lastReadIdx = props.chapters.findIndex((c) => c.id === lastRead);

  return (
    <>
      <div className="detail__controls">
        <label className="control">
          <span className="control__label">Status</span>
          <select
            value={status}
            disabled={busy}
            onChange={(e) => {
              const s = e.target.value as Status;
              setStatus(s);
              void patch({ status: s });
            }}
          >
            {STATUSES.map((s) => (
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
      </div>

      <ol className="chapters">
        {props.chapters.map((c, i) => {
          const read = lastReadIdx >= 0 && i <= lastReadIdx;
          return (
            <li key={c.id} className={`chapter ${read ? 'chapter--read' : ''}`}>
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
          );
        })}
      </ol>
    </>
  );
}
