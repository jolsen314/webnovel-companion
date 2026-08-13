import Link from 'next/link';
import { listSeries } from '../../server/services';
import { relativeTime } from '../../lib/format';
import { DeleteSeriesButton } from './DeleteSeriesButton';

export const dynamic = 'force-dynamic';

type SeriesRow = Awaited<ReturnType<typeof listSeries>>[number];

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
            {series.activeSource && (
              <>
                <span className={`health-dot health-dot--${series.activeSource.health}`} title={series.activeSource.health} />
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

function EmptyState() {
  return (
    <section className="hero">
      <p className="hero__eyebrow">Your shelf</p>
      <h1 className="hero__title">
        It&rsquo;s quiet in here.
        <br />
        Let&rsquo;s fix that.
      </h1>
      <p className="hero__lede">
        Add a series and I&rsquo;ll watch its release feed. When a new chapter drops, your phone lights up&nbsp;— no
        more checking a dozen sites to see if today&rsquo;s the day.
      </p>
      <div className="hero__actions">
        <Link href="/add" className="btn btn--primary">
          Add your first series
        </Link>
      </div>
    </section>
  );
}

export default async function LibraryPage() {
  const series = await listSeries();
  if (series.length === 0) return <EmptyState />;

  const now = new Date();
  const unreadTotal = series.reduce((n, s) => n + s.unread, 0);

  return (
    <section className="stream">
      <div className="stream__head">
        <h1 className="stream__title">Your shelf</h1>
        <span className="stream__meta">
          {series.length} series{unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
        </span>
      </div>
      <div className="stream__list">
        {series.map((s) => (
          <SeriesCard key={s.id} series={s} now={now} />
        ))}
      </div>
    </section>
  );
}
