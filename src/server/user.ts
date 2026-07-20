/**
 * The one place the current user id is resolved. MVP is single-user (a bare `userId`
 * on owned rows, no User table — see CONTEXT.md). Keeping this the SOLE source of the
 * id is what makes the Tier-4 multi-user migration additive: swap this for real
 * session resolution without touching every query.
 */
export function getCurrentUserId(): string {
  return process.env.WEBNOVEL_USER_ID ?? 'local';
}
