import { NextResponse } from 'next/server';
import { switchToPageWatch } from '../../../../../server/services';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await switchToPageWatch(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'Series has no active FEED source to switch.' }, { status: 400 });
  }
  return NextResponse.json(result);
}