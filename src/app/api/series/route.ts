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
    const result = await addSeries(parsed.value);
    if (result.kind === 'needsConfirm') {
      return NextResponse.json(
        { needsConfirm: true, reason: result.reason, suggestedTitle: result.suggestedTitle, url: result.url },
        { status: 200 },
      );
    }
    const { seriesId, resolved, alreadyExisting, similarTo } = result;
    if (alreadyExisting) {
      return NextResponse.json(
        { seriesId, title: resolved.seriesTitle, alreadyExisting: true, message: 'You\'re already tracking this series.' },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { seriesId, title: resolved.seriesTitle, sourceType: resolved.type, chapters: resolved.chapters.length, alreadyExisting: false, ...(similarTo ? { similarTo } : {}) },
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
