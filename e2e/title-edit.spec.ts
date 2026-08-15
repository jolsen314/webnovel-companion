import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test('editing a series title persists', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Old Name',
    chapters: [{ title: 'C1', url: 'https://translator.example/tt/c1' }],
  });
  await page.goto(`/series/${id}`);

  await page.getByRole('button', { name: 'Edit title' }).click();
  const input = page.getByRole('textbox', { name: 'Series title' });
  await input.fill('New Shiny Name');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'New Shiny Name' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New Shiny Name' })).toBeVisible();
});