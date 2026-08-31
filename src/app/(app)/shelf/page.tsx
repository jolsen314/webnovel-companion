import { listSeries } from '../../../server/services';
import { Shelf } from '../Shelf';
import { ThemeScene } from '../ThemeScene';
import { EmptyHero } from '../EmptyHero';
import { ViewTabs } from '../ViewTabs';

export const dynamic = 'force-dynamic';

export default async function ShelfPage() {
  const series = await listSeries();
  if (series.length === 0) return <EmptyHero />;
  return (
    <>
      <ThemeScene variant="appwide" />
      <ViewTabs active="shelf" />
      <Shelf rows={series} now={new Date()} />
    </>
  );
}
