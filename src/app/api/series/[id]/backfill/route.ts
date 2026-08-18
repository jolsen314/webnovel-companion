import { NextResponse } from 'next/server';
import { backfillWithEscalation } from '../../../../../server/services';
import type { IdParams } from '../../../../../server/api/http';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: IdParams) {
  const { id } = await params;
  const result = await backfillWithEscalation(id);
  return NextResponse.json(result);
}
