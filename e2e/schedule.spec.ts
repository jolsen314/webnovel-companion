import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';
import { actAndWaitForSeriesPatch } from './support/actions';

// WP-29: the manual release-schedule editor is the no-fetch fallback for link-only sources.
// It must appear only for a link-only source, persist a weekly schedule, and reopen with the
// saved state (weekday toggles pressed, event kind selected).

test('schedule: link-only series can set a weekly release schedule that persists', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Blocked Series',
    linkOnly: true,
    chapters: [{ title: 'Chapter 1', url: 'https://translator.example/bs/c1' }],
  });
  await page.goto(`/series/${id}`);

  const toggle = page.getByRole('button', { name: 'Release schedule' });
  // No schedule yet → collapsed by default.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await page.getByLabel('Schedule kind').selectOption('WEEKLY');
  for (const day of ['Monday', 'Wednesday', 'Friday']) {
    await page.getByRole('button', { name: day }).click();
  }
  await page.getByLabel('Prediction kind').selectOption('UNLOCKED');

  await actAndWaitForSeriesPatch(page, id, () => page.getByRole('button', { name: 'Save schedule' }).click());
  await expect(page.getByText('Saved')).toBeVisible();

  // Reload: a set schedule defaults open, with the saved weekdays pressed and event kind selected.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Release schedule' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Schedule kind')).toHaveValue('WEEKLY');
  await expect(page.getByLabel('Prediction kind')).toHaveValue('UNLOCKED');
  for (const day of ['Monday', 'Wednesday', 'Friday']) {
    await expect(page.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false');

  // Collapsed preview summarizes it.
  await page.getByRole('button', { name: 'Release schedule' }).click();
  await expect(page.locator('.notes__preview')).toHaveText('Mon, Wed, Fri · now free');
});

test('schedule: a normally-fetching source shows no schedule editor', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Fetching Series',
    chapters: [{ title: 'Chapter 1', url: 'https://translator.example/fs/c1' }],
  });
  await page.goto(`/series/${id}`);
  await expect(page.getByRole('button', { name: 'Release schedule' })).toHaveCount(0);
});
