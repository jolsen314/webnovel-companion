import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSeries } from '../../../../server/services';
import { EditableTitle } from './EditableTitle';
import { SeriesDetail, type ChapterLite } from './SeriesDetail';

export const dynamic = 'force-dynamic';

const STATUSES = ['READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED'] as const;

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
  }));
  const status = STATUSES.includes(series.status as (typeof STATUSES)[number])
    ? (series.status as (typeof STATUSES)[number])
    : 'READING';

  return (
    <section className="detail">
      <Link href="/" className="detail__back">
        ← Shelf
      </Link>
      <EditableTitle id={series.id} initialTitle={series.title} />
      <div className="detail__meta">
        {active && (
          <>
            <span className={`health-dot health-dot--${active.health}`} title={active.health} />
            <a href={active.url} target="_blank" rel="noreferrer">
              {active.host}
            </a>
            <span>·</span>
          </>
        )}
        <span>{series.chapters.length} chapters</span>
      </div>

      <SeriesDetail
        id={series.id}
        title={series.title}
        status={status}
        rating={series.rating}
        chapters={chapters}
        lastReadChapterId={series.progress?.lastReadChapterId ?? null}
        sourceType={active?.type ?? 'PAGE_WATCH'}
      />
    </section>
  );
}
