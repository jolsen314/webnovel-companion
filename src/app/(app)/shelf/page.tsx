import { listSeries } from '../../../server/services';
import { Shelf } from '../Shelf';
import { ThemeScene } from '../ThemeScene';
import { EmptyHero } from '../EmptyHero';

export const dynamic = 'force-dynamic';

export default async function ShelfPage() {
  const series = await listSeries();
  if (series.length === 0) return <EmptyHero />;
  return (
    <>
      <ThemeScene variant="appwide" />
      <Shelf rows={series} />
    </>
  );
}
