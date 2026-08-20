import type { Page } from '@playwright/test';

/**
 * Run a UI action that triggers a `PATCH /api/series/<id>` and wait for the server to
 * acknowledge it before continuing. The detail-page controls (status, rating, mark-read,
 * title save) fire their PATCH fire-and-forget (`void patch(...)`) with an optimistic UI
 * update, so a test that mutates and then immediately `page.reload()`s can race the write:
 * the reload reads the pre-write row and the persisted-state assertion fails intermittently.
 * Awaiting the PATCH response makes those "mutate → reload → assert persisted" flows
 * deterministic without touching product code.
 */
export async function actAndWaitForSeriesPatch(
  page: Page,
  seriesId: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/series/${seriesId}`) && r.request().method() === 'PATCH' && r.ok(),
  );
  await action();
  await patched;
}
