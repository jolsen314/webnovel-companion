import { NextResponse } from 'next/server';
import { addSeries, listSeries } from '../../../server/services';
import { parseAddSeriesBody } from '../../../server/api/validation';
import { jsonError, readJson } from '../../../server/api/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const series = await listSeries();
  return NextResponse.json({ series });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error);

  const parsed = parseAddSeriesBody(body.value);
  if (!parsed.ok) return jsonError(parsed.error);

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
