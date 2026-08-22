import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSeries } from '../../../../server/services';
import { EditableTitle } from './EditableTitle';
import { SeriesDetail, type ChapterLite } from './SeriesDetail';
import type { ScheduleInit } from './ScheduleEditor';
import { SERIES_STATUSES } from '../../../../lib/series';

export const dynamic = 'force-dynamic';

export default async function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const series = await getSeries(id);
  if (!series) notFound();

  const active = series.sources.find((s) => s.isActive) ?? series.sources[0] ?? null;
  const chapters: ChapterLite[] = series.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    number: c.number,
    url: c.url,
    access: c.access,
  }));
  const status = SERIES_STATUSES.includes(series.status as (typeof SERIES_STATUSES)[number])
    ? (series.status as (typeof SERIES_STATUSES)[number])
    : 'READING';

  // Manual release schedule (WP-29): only offered for link-only sources (no fetch to notify from).
  const scheduleInit: ScheduleInit = {
    kind: series.releaseScheduleKind ?? 'NONE',
    cadenceDays: series.releaseCadenceDays,
    anchoredOn: series.releaseAnchoredOn ? series.releaseAnchoredOn.toISOString().slice(0, 10) : null,
    weekdays: series.releaseWeekdays,
    eventKind: series.releaseEventKind,
  };

  return (
    <section className="detail">
      <Link href="/" className="detail__back">
        ← Shelf
      </Link>
      <EditableTitle id={series.id} initialTitle={series.title} />
      <div className="detail__meta">
        {active && (
          <>
            {!active.linkOnly && (
              <span className={`health-dot health-dot--${active.health}`} title={active.health} />
            )}
            <a href={active.url} target="_blank" rel="noreferrer">
              {active.host}
            </a>
            <span>·</span>
          </>
        )}
        {active?.linkOnly && <span className="status-chip">link-only</span>}
        <span>{series.chapters.length} chapters</span>
      </div>

      <SeriesDetail
        id={series.id}
        title={series.title}
        status={status}
        rating={series.rating}
        notes={series.notes ?? ''}
        chapters={chapters}
        lastReadChapterId={series.progress?.lastReadChapterId ?? null}
        sourceType={active?.type ?? 'PAGE_WATCH'}
        showSchedule={!!active?.linkOnly}
        scheduleInit={scheduleInit}
      />
    </section>
  );
}
