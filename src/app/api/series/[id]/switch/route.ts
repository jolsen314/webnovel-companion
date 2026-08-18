import { NextResponse } from 'next/server';
import { switchToPageWatch } from '../../../../../server/services';
import type { IdParams } from '../../../../../server/api/http';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: IdParams) {
  const { id } = await params;
  const result = await switchToPageWatch(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'Series has no active FEED source to switch.' }, { status: 400 });
  }
  return NextResponse.json(result);
}