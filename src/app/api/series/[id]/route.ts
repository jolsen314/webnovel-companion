import { NextResponse } from 'next/server';
import { getSeries, updateSeries, deleteSeries } from '../../../../server/services';
import { parseSeriesUpdate } from '../../../../server/api/validation';
import { jsonError, readJson } from '../../../../server/api/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const series = await getSeries(id);
  if (!series) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ series });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error);

  const parsed = parseSeriesUpdate(body.value);
  if (!parsed.ok) return jsonError(parsed.error);

  const updated = await updateSeries(id, parsed.value);
  if (!updated) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deleteSeries(id);
  if (!result.deleted) return NextResponse.json({ error: 'Series not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
