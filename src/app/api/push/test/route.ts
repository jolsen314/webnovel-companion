import { NextResponse } from 'next/server';
import { sendTestNotification } from '../../../../server/services';

export const dynamic = 'force-dynamic';

/** Send a canned test push to this user's subscriptions (auth-gated by middleware). */
export async function POST() {
  try {
    return NextResponse.json(await sendTestNotification());
  } catch (e) {
    // Surface the real reason (e.g. a malformed VAPID subject) instead of a bare 500.
    const message = e instanceof Error ? e.message : 'Push send failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
