import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test.describe('delete series', () => {
  test('detail delete redirects to the shelf and removes the series', async ({ page }) => {
    const { id } = await seedSeries({
      title: 'Delete Me',
      chapters: [{ title: 'C1', url: 'https://translator.example/dm/c1' }],
    });
    await page.goto(`/series/${id}`);
    await page.getByRole('button', { name: 'Delete series' }).click();
    await page.getByRole('button', { name: 'Delete forever' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Delete Me' })).toHaveCount(0);
  });

  test('detail delete Cancel dismisses the confirm and deletes nothing', async ({ page }) => {
    const { id } = await seedSeries({
      title: 'Spare Me',
      chapters: [{ title: 'C1', url: 'https://translator.example/sm/c1' }],
    });
    await page.goto(`/series/${id}`);
    await page.getByRole('button', { name: 'Delete series' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Confirm collapsed back to the trigger, still on the detail page, nothing deleted.
    await expect(page.getByRole('button', { name: 'Delete series' })).toBeVisible();
    await expect(page).toHaveURL(`/series/${id}`);
    await page.goto('/shelf');
    await expect(page.getByRole('heading', { name: 'Spare Me' })).toBeVisible();
  });

  test('shelf trash removes the card and does not navigate into the series', async ({ page }) => {
    await seedSeries({ title: 'Keep One', chapters: [{ title: 'C1', url: 'https://translator.example/k/c1' }] });
    await seedSeries({ title: 'Trash Me', chapters: [{ title: 'C1', url: 'https://translator.example/t/c1' }] });
    await page.goto('/shelf');

    await page.getByRole('button', { name: 'Delete Trash Me' }).click();
    await expect(page).toHaveURL('/shelf'); // trash tap must NOT open the series

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Trash Me' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Keep One' })).toBeVisible();
  });

  test('shelf trash Cancel closes the popover and keeps the card', async ({ page }) => {
    await seedSeries({ title: 'Stay Put', chapters: [{ title: 'C1', url: 'https://translator.example/sp/c1' }] });
    await page.goto('/shelf');

    await page.getByRole('button', { name: 'Delete Stay Put' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Popover closed, card still there, nothing deleted.
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Stay Put' })).toBeVisible();
  });
});