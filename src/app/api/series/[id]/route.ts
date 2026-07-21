import { NextResponse } from 'next/server';
import { getSeries, updateSeries } from '../../../../server/services';
import { parseSeriesUpdate } from '../../../../server/api/validation';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const series = await getSeries(id);
  if (!series) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ series });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = parseSeriesUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated = await updateSeries(id, parsed.value);
  if (!updated) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
