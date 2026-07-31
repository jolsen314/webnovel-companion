import { NextResponse } from 'next/server';
import { pollAllSources, evaluateSchedules, notifyForEffects } from '../../../../server/services';
import { isAuthorizedCron, parsePollTier } from '../../../../server/api/validation';

export const dynamic = 'force-dynamic';
// Vercel Hobby's function ceiling is 300s (5 min). pollAllSources self-limits to POLL_BUDGET_MS
// (270s) and rotates least-recently-polled first (WP-41), so the run drains fairly and finishes
// with headroom for the push + schedule steps below rather than being killed mid-loop.
export const maxDuration = 300;

/** Vercel Cron target: poll every active source, diff new chapters, update health. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tier = parsePollTier(new URL(request.url).searchParams);
  const effects = await pollAllSources(undefined, undefined, undefined, tier);
  // No-fetch fallback: predicted releases for series with a manual schedule (WP-29).
  const scheduleEffects = await evaluateSchedules();

  // Web Push (WP-09): new chapters, sources that crossed down, and due scheduled releases.
  // Isolated so a push/VAPID misconfiguration can't fail the poll — the diff already persisted.
  let push: Awaited<ReturnType<typeof notifyForEffects>> | { error: string };
  try {
    push = await notifyForEffects(effects, scheduleEffects);
  } catch (e) {
    push = { error: e instanceof Error ? e.message : 'push send failed' };
    console.error('cron push send failed:', e);
  }

  const summary = {
    tier,
    polled: effects.length,
    newChapters: effects.reduce((n, e) => n + e.newChapters.length, 0),
    wentDown: effects.filter((e) => e.crossedDown).length,
    scheduledReleases: scheduleEffects.length,
    pushed: push,
  };
  return NextResponse.json(summary);
}
