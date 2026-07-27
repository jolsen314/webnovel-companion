import { NextResponse } from 'next/server';
import { backfillFromToc } from '../../../../../server/services';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await backfillFromToc(id);
  return NextResponse.json(result);
}
