import { NextResponse } from 'next/server';
import { getNotificationPrefs, updateNotificationPrefs } from '../../../server/services';
import { parseNotificationPrefsPatch } from '../../../server/api/validation';

export const dynamic = 'force-dynamic';

/** Current per-type push preferences (defaults when unset). */
export async function GET() {
  return NextResponse.json(await getNotificationPrefs());
}

/** Update a subset of the per-type push toggles. */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = parseNotificationPrefsPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  return NextResponse.json(await updateNotificationPrefs(parsed.value));
}
