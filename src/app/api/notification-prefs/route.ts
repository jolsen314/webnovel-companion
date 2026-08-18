import { NextResponse } from 'next/server';
import { getNotificationPrefs, updateNotificationPrefs } from '../../../server/services';
import { parseNotificationPrefsPatch } from '../../../server/api/validation';
import { jsonError, readJson } from '../../../server/api/http';

export const dynamic = 'force-dynamic';

/** Current per-type push preferences (defaults when unset). */
export async function GET() {
  return NextResponse.json(await getNotificationPrefs());
}

/** Update a subset of the per-type push toggles. */
export async function PUT(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return jsonError(body.error);

  const parsed = parseNotificationPrefsPatch(body.value);
  if (!parsed.ok) return jsonError(parsed.error);

  return NextResponse.json(await updateNotificationPrefs(parsed.value));
}
