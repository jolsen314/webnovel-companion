import { NextResponse } from 'next/server';
import { sendTestNotification } from '../../../../server/services';

export const dynamic = 'force-dynamic';

/** Send a canned test push to this user's subscriptions (auth-gated by middleware). */
export async function POST() {
  const summary = await sendTestNotification();
  return NextResponse.json(summary);
}
