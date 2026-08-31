'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { relativeTime } from '../../lib/format';
import { countNewSince, type DownSource, type Feed as FeedData, type FeedEvent } from '../../lib/feed';

const SEEN_KEY = 'feedSeenAt';

function AttentionStrip({ sources }: { sources: DownSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="feed-attention">
      <button type="button" className="feed-attention__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {sources.length} source{sources.length === 1 ? '' : 's'} {sources.length === 1 ? 'needs' : 'need'} checking today
      </button>
      {open && (
        <ul className="feed-attention__list">
          {sources.map((s) => (
            <li key={`${s.seriesId}:${s.host}`}>
              <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                {s.host}
              </a>
              {' — '}
              <Link href={`/series/${s.seriesId}`}>{s.seriesTitle}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ ev, now }: { ev: FeedEvent; now: Date }) {
  return (
    <li className={`feed-row${ev.read ? ' feed-row--read' : ''}`}>
      <a className="feed-row__main" href={ev.chapterUrl} target="_blank" rel="noreferrer">
        {ev.kind === 'NOW_FREE' && <span className="feed-row__tag">now free</span>}
        {ev.chapterNumber != null && <span className="feed-row__num">#{ev.chapterNumber}</span>}
        <span className="feed-row__title">{ev.chapterTitle}</span>
        {ev.read && (
          <span className="feed-row__check" aria-label="read">
            ✓
          </span>
        )}
      </a>
      <div className="feed-row__meta">
        <Link href={`/series/${ev.seriesId}`} className="feed-row__series">
          {ev.seriesTitle}
        </Link>
        <span className="feed-row__time">{relativeTime(ev.at, now)}</span>
      </div>
    </li>
  );
}

export function Feed({ data, now }: { data: FeedData; now: Date }) {
  // Per-device seen watermark: read the pre-visit value on mount, then advance storage to the
  // newest event so the next visit measures "new" from now. seenAt state keeps the pre-visit value.
  const [seenAt, setSeenAt] = useState<Date | null>(null);
  useEffect(() => {
    const raw = window.localStorage.getItem(SEEN_KEY);
    setSeenAt(raw ? new Date(raw) : null);
    const newest = data.groups[0]?.items[0]?.at;
    if (newest) window.localStorage.setItem(SEEN_KEY, new Date(newest).toISOString());
  }, [data]);

  const totalEvents = data.groups.reduce((n, g) => n + g.items.length, 0);
  if (data.attention.length === 0 && totalEvents === 0) {
    return <p className="feed-empty">Nothing new — you&rsquo;re all caught up.</p>;
  }

  const newCount = countNewSince(data, seenAt);
  let idx = 0;

  return (
    <div className="feed">
      {data.attention.length > 0 && <AttentionStrip sources={data.attention} />}
      {data.groups.map((g) => (
        <section key={g.key} className="feed-day">
          <h2 className="feed-day__label">{g.label}</h2>
          <ul className="feed-day__list">
            {g.items.map((ev) => {
              const showDivider = newCount > 0 && idx === newCount;
              idx += 1;
              return (
                <Fragment key={`${ev.chapterUrl}:${ev.kind}`}>
                  {showDivider && (
                    <li className="feed-divider" aria-hidden="true">
                      Seen before this
                    </li>
                  )}
                  <EventRow ev={ev} now={now} />
                </Fragment>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
