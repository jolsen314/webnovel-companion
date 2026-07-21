import { NextResponse } from 'next/server';
import { pollAllSources } from '../../../../server/services';
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

  // TODO(WP-09): send Web Push for effects with new chapters / crossedDown.
  const summary = {
    polled: effects.length,
    newChapters: effects.reduce((n, e) => n + e.newChapters.length, 0),
    wentDown: effects.filter((e) => e.crossedDown).length,
  };
  return NextResponse.json(summary);
}
