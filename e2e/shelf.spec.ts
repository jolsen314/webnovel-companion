import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

// WP-28a — shelf sort + filter. Verifies the controls wiring end-to-end: the pure ordering /
// narrowing is unit-tested in tests/unit/shelf.test.ts; here we prove the UI drives it and
// that the choice persists.
test('WP-28a: shelf sort reorders the grid and persists across reload', async ({ page }) => {
  await seedSeries({ title: 'Zeta Tale', chapters: [{ title: 'c1', url: 'https://ex.test/z/1' }] });
  await seedSeries({ title: 'Alpha Tale', chapters: [{ title: 'c1', url: 'https://ex.test/a/1' }] });
  await seedSeries({ title: 'Mid Tale', chapters: [{ title: 'c1', url: 'https://ex.test/m/1' }] });

  await page.goto('/shelf');
  await expect(page.locator('.card__title')).toHaveCount(3);

  // A–Z sort → deterministic title order.
  await page.getByLabel('Sort', { exact: true }).selectOption('title');
  await expect(page.locator('.card__title')).toHaveText(['Alpha Tale', 'Mid Tale', 'Zeta Tale']);

  // The choice persists (localStorage) across a reload.
  await page.reload();
  await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('title');
  await expect(page.locator('.card__title')).toHaveText(['Alpha Tale', 'Mid Tale', 'Zeta Tale']);
});

test('WP-28a: status, rating, and search filters narrow the grid and update the count', async ({ page }) => {
  await seedSeries({ title: 'Reading Five', status: 'READING', rating: 5, chapters: [{ title: 'c', url: 'https://ex.test/r/1' }] });
  await seedSeries({ title: 'Planned Two', status: 'PLANNED', rating: 2, chapters: [{ title: 'c', url: 'https://ex.test/p/1' }] });
  await seedSeries({ title: 'Reading Unrated', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/u/1' }] });

  await page.goto('/shelf');
  await expect(page.locator('.card__title')).toHaveCount(3);

  // Status filter → only the PLANNED series; the count line reflects the narrowing.
  await page.getByLabel('Status', { exact: true }).selectOption('PLANNED');
  await expect(page.locator('.card__title')).toHaveText(['Planned Two']);
  await expect(page.locator('.stream__meta')).toHaveText('showing 1 of 3 series');
  await page.getByLabel('Status', { exact: true }).selectOption('ALL');

  // Rating filter (minimum) → drops the 2★ and the unrated, keeps the 5★.
  await page.getByLabel('Rating', { exact: true }).selectOption('4');
  await expect(page.locator('.card__title')).toHaveText(['Reading Five']);
  await page.getByLabel('Rating', { exact: true }).selectOption('any');

  // Search → case-insensitive title substring.
  await page.getByLabel('Search titles', { exact: true }).fill('planned');
  await expect(page.locator('.card__title')).toHaveText(['Planned Two']);

  // No match → the empty-filter message, not the empty-shelf hero.
  await page.getByLabel('Search titles', { exact: true }).fill('zzz nothing');
  await expect(page.locator('.card__title')).toHaveCount(0);
  await expect(page.getByText('No series match these filters.')).toBeVisible();
});
