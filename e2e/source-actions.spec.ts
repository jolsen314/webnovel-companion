import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

// The Backfill + Track-unlocks buttons trigger routes that fetch the real network server-side.
// Stub the browser→API calls so the real routes never run — this covers the client's own
// responsibility (fire the request, surface the returned result). The server-side add/reconcile
// logic is owned by the integration tests.

test('Backfill from TOC shows the result hint (stubbed)', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Feed Series',
    sourceType: 'FEED',
    chapters: [{ title: 'C1', url: 'https://translator.example/fs/c1' }],
  });
  await page.route(`**/api/series/${id}/backfill`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ added: 3, reconciled: 1 }) }),
  );
  await page.goto(`/series/${id}`);
  await page.getByRole('button', { name: 'Backfill from TOC' }).click();
  await expect(page.getByText('Added 3 · updated 1')).toBeVisible();
});

test('Track unlocks (switch to TOC) shows the switch hint (stubbed)', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Feed Series Two',
    sourceType: 'FEED',
    chapters: [{ title: 'C1', url: 'https://translator.example/fs2/c1' }],
  });
  await page.route(`**/api/series/${id}/switch`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ added: 2, fetchMode: 'PLAIN', rendered: false }),
    }),
  );
  await page.goto(`/series/${id}`);
  await page.getByRole('button', { name: 'Track unlocks (switch to TOC)' }).click();
  await expect(page.getByText('Switched · 2 chapters')).toBeVisible();
});