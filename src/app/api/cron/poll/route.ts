import { NextResponse } from 'next/server';
import { pollAllSources, evaluateSchedules, notifyForEffects } from '../../../../server/services';
import { isAuthorizedCron } from '../../../../server/api/validation';

export const dynamic = 'force-dynamic';
// Poll each source; keep well under Vercel's function ceiling.
export const maxDuration = 60;

/** Vercel Cron target: poll every active source, diff new chapters, update health. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effects = await pollAllSources();
  // No-fetch fallback: predicted releases for series with a manual schedule (WP-29).
  const scheduleEffects = await evaluateSchedules();

  // Web Push (WP-09): new chapters, sources that crossed down, and due scheduled releases.
  const push = await notifyForEffects(effects, scheduleEffects);

  const summary = {
    polled: effects.length,
    newChapters: effects.reduce((n, e) => n + e.newChapters.length, 0),
    wentDown: effects.filter((e) => e.crossedDown).length,
    scheduledReleases: scheduleEffects.length,
    pushed: push,
  };
  return NextResponse.json(summary);
}
