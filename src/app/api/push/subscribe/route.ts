import { NextResponse } from 'next/server';
import { savePushSubscription } from '../../../../server/services';
import { parsePushSubscription } from '../../../../server/api/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = parsePushSubscription(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  await savePushSubscription(parsed.value);
  return NextResponse.json({ ok: true }, { status: 201 });
}
