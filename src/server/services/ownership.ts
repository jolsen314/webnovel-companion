import { db } from '../db';
import { getCurrentUserId } from '../user';

/**
 * The security-critical ownership guards, single-sourced so every user-scoped service
 * checks the same way. Each answers "does this belong to the current user?" with a cheap
 * id-only lookup; callers map `false` to their own not-found/return shape.
 */

/** True when the series belongs to the current user. */
export async function ownsSeries(seriesId: string): Promise<boolean> {
  const row = await db.series.findFirst({
    where: { id: seriesId, userId: getCurrentUserId() },
    select: { id: true },
  });
  return row != null;
}

/** True when the source's series belongs to the current user. */
export async function ownsSource(sourceId: string): Promise<boolean> {
  const row = await db.source.findFirst({
    where: { id: sourceId, series: { userId: getCurrentUserId() } },
    select: { id: true },
  });
  return row != null;
}
