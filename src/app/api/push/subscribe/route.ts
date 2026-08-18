import { NextResponse } from 'next/server';
import { savePushSubscription } from '../../../../server/services';
import { parsePushSubscription } from '../../../../server/api/validation';
import { jsonError, readJson } from '../../../../server/api/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error);

  const parsed = parsePushSubscription(body.value);
  if (!parsed.ok) return jsonError(parsed.error);

  await savePushSubscription(parsed.value);
  return NextResponse.json({ ok: true }, { status: 201 });
}
