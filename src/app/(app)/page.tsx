import { listSeries, getFeed } from '../../server/services';
import { Feed } from './Feed';
import { ViewTabs } from './ViewTabs';
import { ThemeScene } from './ThemeScene';
import { EmptyHero } from './EmptyHero';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const series = await listSeries();
  if (series.length === 0) return <EmptyHero />;

  const now = new Date();
  const feed = await getFeed(now);
  return (
    <>
      <ThemeScene variant="appwide" />
      <section className="stream">
        <div className="stream__head">
          <ViewTabs active="feed" />
          <div className="stream__headline">
            <h1 className="stream__title">What&rsquo;s new</h1>
          </div>
        </div>
        <Feed data={feed} now={now} />
      </section>
    </>
  );
}
