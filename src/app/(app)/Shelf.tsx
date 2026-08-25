'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { relativeTime } from '../../lib/format';
import { sortSeries, filterSeries, type ShelfSort } from '../../lib/shelf';
import { SERIES_STATUSES, type SeriesStatus } from '../../lib/series';
import type { listSeries } from '../../server/services';
import { DeleteSeriesButton } from './DeleteSeriesButton';

type SeriesRow = Awaited<ReturnType<typeof listSeries>>[number];

const SORT_OPTIONS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'unread', label: 'Unread first' },
  { value: 'title', label: 'A–Z' },
  { value: 'rating', label: 'Rating' },
];

// Friendly Title-Case labels; the shelf-facing status order (Reading first, Dropped last).
const STATUS_ORDER: SeriesStatus[] = ['READING', 'PLANNED', 'PAUSED', 'COMPLETED', 'DROPPED'];
const statusLabel = (s: SeriesStatus) => s.charAt(0) + s.slice(1).toLowerCase();

const SORT_KEY = 'shelfSort';
const STATUS_KEY = 'shelfStatus';
const MIN_RATING_KEY = 'shelfMinRating';

function isSort(v: string | null): v is ShelfSort {
  return v === 'recent' || v === 'unread' || v === 'title' || v === 'rating';
}
function isStatusFilter(v: string | null): v is SeriesStatus | 'ALL' {
  return v === 'ALL' || (v != null && (SERIES_STATUSES as readonly string[]).includes(v));
}

function SeriesCard({ series, now }: { series: SeriesRow; now: Date }) {
  const { latestChapter: latest, unread } = series;
  return (
    <div className="card-wrap">
      <Link href={`/series/${series.id}`} className="card">
        {unread > 0 && <span className="card__ribbon" aria-hidden="true" />}
        <div className="card__body">
          <div className="card__top">
            <h2 className="card__title">{series.title}</h2>
            {unread > 0 && <span className="card__unread">{unread} new</span>}
          </div>
          <p className="card__latest">
            {latest ? (
              <>
                {latest.number != null && <span className="card__num">#{latest.number} </span>}
                <b>{latest.title}</b>
              </>
            ) : (
              'No chapters yet'
            )}
          </p>
          <div className="card__meta">
            {series.status !== 'READING' && <span className="status-chip">{series.status}</span>}
            {series.activeSource?.linkOnly && <span className="status-chip">link-only</span>}
            {series.activeSource && (
              <>
                {!series.activeSource.linkOnly && (
                  <span className={`health-dot health-dot--${series.activeSource.health}`} title={series.activeSource.health} />
                )}
                <span>{series.activeSource.host}</span>
              </>
            )}
            {latest?.at && <span>· {relativeTime(new Date(latest.at), now)}</span>}
          </div>
        </div>
      </Link>
      <DeleteSeriesButton id={series.id} title={series.title} chapterCount={series.chapterCount} />
    </div>
  );
}

export function Shelf({ rows, now }: { rows: SeriesRow[]; now: Date }) {
  // Defaults match the server render for hydration safety; stored prefs applied in the mount effect.
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [statusFilter, setStatusFilter] = useState<SeriesStatus | 'ALL'>('ALL');
  const [minRating, setMinRating] = useState<number | null>(null);
  // Query is intentionally transient — not persisted, resets on reload.
  const [query, setQuery] = useState('');

  useEffect(() => {
    const storedSort = window.localStorage.getItem(SORT_KEY);
    if (isSort(storedSort)) setSort(storedSort);
    const storedStatus = window.localStorage.getItem(STATUS_KEY);
    if (isStatusFilter(storedStatus)) setStatusFilter(storedStatus);
    const storedRating = window.localStorage.getItem(MIN_RATING_KEY);
    const parsed = storedRating ? Number(storedRating) : NaN;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) setMinRating(parsed);
  }, []);

  function chooseSort(next: ShelfSort) {
    setSort(next);
    window.localStorage.setItem(SORT_KEY, next);
  }
  function chooseStatus(next: SeriesStatus | 'ALL') {
    setStatusFilter(next);
    window.localStorage.setItem(STATUS_KEY, next);
  }
  function chooseMinRating(next: number | null) {
    setMinRating(next);
    if (next == null) window.localStorage.removeItem(MIN_RATING_KEY);
    else window.localStorage.setItem(MIN_RATING_KEY, String(next));
  }

  const visible = useMemo(
    () => sortSeries(filterSeries(rows, { status: statusFilter, query, minRating }), sort),
    [rows, statusFilter, query, minRating, sort],
  );

  const filtering = statusFilter !== 'ALL' || query.trim() !== '' || minRating != null;
  const unreadTotal = rows.reduce((n, s) => n + s.unread, 0);

  return (
    <section className="stream">
      <div className="stream__head">
        <div className="stream__headline">
          <h1 className="stream__title">Your shelf</h1>
          <span className="stream__meta">
            {filtering
              ? `showing ${visible.length} of ${rows.length} series`
              : `${rows.length} series${unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}`}
          </span>
        </div>
        <div className="shelf-controls">
          <div className="shelf-control">
            <span className="shelf-control__label" aria-hidden="true">
              Sort
            </span>
            <select
              className="shelf-select"
              aria-label="Sort"
              value={sort}
              onChange={(e) => chooseSort(e.target.value as ShelfSort)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="shelf-control">
            <span className="shelf-control__label" aria-hidden="true">
              Status
            </span>
            <select
              className="shelf-select"
              aria-label="Status"
              value={statusFilter}
              onChange={(e) => chooseStatus(e.target.value as SeriesStatus | 'ALL')}
            >
              <option value="ALL">All</option>
              {STATUS_ORDER.map((st) => (
                <option key={st} value={st}>
                  {statusLabel(st)}
                </option>
              ))}
            </select>
          </div>
          <div className="shelf-control">
            <span className="shelf-control__label" aria-hidden="true">
              Rating
            </span>
            <select
              className="shelf-select"
              aria-label="Rating"
              value={minRating ?? 'any'}
              onChange={(e) => chooseMinRating(e.target.value === 'any' ? null : Number(e.target.value))}
            >
              <option value="any">Any</option>
              <option value="5">5★</option>
              <option value="4">4★+</option>
              <option value="3">3★+</option>
              <option value="2">2★+</option>
              <option value="1">1★+</option>
            </select>
          </div>
          <input
            className="shelf-search"
            type="search"
            placeholder="Search titles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search titles"
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="shelf-empty">No series match these filters.</p>
      ) : (
        <div className="stream__list">
          {visible.map((s) => (
            <SeriesCard key={s.id} series={s} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
