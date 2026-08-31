'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sortSeries, filterSeries, type ShelfSort } from '../../lib/shelf';
import { SERIES_STATUSES, type SeriesStatus } from '../../lib/series';
import type { listSeries } from '../../server/services';
import { DeleteSeriesButton } from './DeleteSeriesButton';
import { WaxBadge } from './WaxBadge';
import { ViewTabs } from './ViewTabs';

type SeriesRow = Awaited<ReturnType<typeof listSeries>>[number];

const SORT_OPTIONS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'added', label: 'Recently added' },
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
  return v === 'recent' || v === 'unread' || v === 'title' || v === 'rating' || v === 'added';
}
function isStatusFilter(v: string | null): v is SeriesStatus | 'ALL' {
  return v === 'ALL' || (v != null && (SERIES_STATUSES as readonly string[]).includes(v));
}

function SeriesCard({ series, highlight }: { series: SeriesRow; highlight: boolean }) {
  const { unread } = series;
  const showUnread = series.status === 'READING' && unread > 0;
  const count = series.chapterCount;
  return (
    <div className={`card-wrap${highlight ? ' card-wrap--added' : ''}`} id={`series-${series.id}`}>
      <Link href={`/series/${series.id}`} className="card">
        <span className="roll roll--l" aria-hidden="true" />
        <span className="roll roll--r" aria-hidden="true" />
        {showUnread && <span className="card__ribbon" aria-hidden="true" />}
        <div className="card__body">
          <div className="card__top">
            <h2 className="card__title">{series.title}</h2>
            {showUnread && <WaxBadge count={unread} />}
          </div>
          <p className="card__count">{count > 0 ? `${count} chapter${count === 1 ? '' : 's'}` : 'No chapters yet'}</p>
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
          </div>
        </div>
      </Link>
      <div className="hud" aria-hidden="true">
        <span className="accent" />
        <span className="br br--tl" />
        <span className="br br--br" />
        <span className="chev">//</span>
        <span className="hatch" />
        <span className="flare" />
      </div>
      <DeleteSeriesButton id={series.id} title={series.title} chapterCount={series.chapterCount} />
    </div>
  );
}

export function Shelf({ rows }: { rows: SeriesRow[] }) {
  // Defaults match the server render for hydration safety; stored prefs applied in the mount effect.
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [statusFilter, setStatusFilter] = useState<SeriesStatus | 'ALL'>('ALL');
  const [minRating, setMinRating] = useState<number | null>(null);
  // Query is intentionally transient — not persisted, resets on reload.
  const [query, setQuery] = useState('');

  // Saved shelf prefs are applied client-side after mount; `hydrated` gates the ?added scroll
  // until they're in effect, so we never scroll to a card the saved filter ends up hiding.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const storedSort = window.localStorage.getItem(SORT_KEY);
    if (isSort(storedSort)) setSort(storedSort);
    const storedStatus = window.localStorage.getItem(STATUS_KEY);
    if (isStatusFilter(storedStatus)) setStatusFilter(storedStatus);
    const storedRating = window.localStorage.getItem(MIN_RATING_KEY);
    const parsed = storedRating ? Number(storedRating) : NaN;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) setMinRating(parsed);
    setHydrated(true);
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

  const params = useSearchParams();
  const addedId = params.get('added');
  useEffect(() => {
    if (!hydrated || !addedId) return;
    // Only scroll if the card survived the (now-applied) saved filter — otherwise it isn't in the
    // DOM, and we must not scroll to where it briefly sat during the pre-hydration default render.
    const el = document.getElementById(`series-${addedId}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [hydrated, addedId, visible]);

  const filtering = statusFilter !== 'ALL' || query.trim() !== '' || minRating != null;
  const unreadTotal = rows.reduce((n, s) => n + s.unread, 0);

  return (
    <section className="stream">
      <div className="stream__head">
        <ViewTabs active="shelf" />
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
            <SeriesCard key={s.id} series={s} highlight={s.id === addedId} />
          ))}
        </div>
      )}
    </section>
  );
}
