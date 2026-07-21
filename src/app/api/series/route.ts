import { NextResponse } from 'next/server';
import { addSeries, listSeries } from '../../../server/services';
import { parseAddSeriesBody } from '../../../server/api/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const series = await listSeries();
  return NextResponse.json({ series });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = parseAddSeriesBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { seriesId, resolved } = await addSeries(parsed.value);
    return NextResponse.json(
      { seriesId, title: resolved.seriesTitle, sourceType: resolved.type, chapters: resolved.chapters.length },
      { status: 201 },
    );
  } catch (error) {
    // Add-time reachability / resolution failures are surfaced to the user.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not add that series.' },
      { status: 502 },
    );
  }
}
