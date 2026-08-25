import Link from 'next/link';
import { listSeries } from '../../server/services';
import { Shelf } from './Shelf';

export const dynamic = 'force-dynamic';

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

  return <Shelf rows={series} now={new Date()} />;
}
