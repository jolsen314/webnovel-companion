/**
 * The reader's shelf status for a series — the single source of truth for this domain
 * enum. Mirrors the Prisma `SeriesStatus` enum as a pure, Next-/Prisma-free tuple so
 * every layer (request validation, poll cadence, the detail UI) shares one definition
 * and can't silently drift when a status is added or removed.
 */
export const SERIES_STATUSES = ['READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED'] as const;

export type SeriesStatus = (typeof SERIES_STATUSES)[number];
