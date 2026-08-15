import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test('library grid renders and detail controls persist', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Ctrl Series',
    chapters: [
      { title: 'Chapter 1', url: 'https://translator.example/cs/c1' },
      { title: 'Chapter 2', url: 'https://translator.example/cs/c2' },
    ],
  });

  // Library grid renders the seeded card.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ctrl Series' })).toBeVisible();

  // Detail: the chapters render as clickable links pointing at their real URLs.
  await page.goto(`/series/${id}`);
  const ch1 = page.getByRole('link', { name: 'Chapter 1' });
  await expect(ch1).toHaveAttribute('href', 'https://translator.example/cs/c1');
  await expect(ch1).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Chapter 2' })).toHaveAttribute(
    'href',
    'https://translator.example/cs/c2',
  );

  // Detail controls: status, rating, mark-read.
  await page.getByLabel('Status').selectOption('COMPLETED');
  await page.getByRole('button', { name: '3 stars' }).click();
  await page.getByRole('button', { name: 'mark read' }).first().click();

  await page.reload();
  await expect(page.getByLabel('Status')).toHaveValue('COMPLETED');
  await expect(page.getByRole('button', { name: '3 stars' })).toHaveClass(/star--on/);
  await expect(page.getByRole('button', { name: 'current' })).toBeVisible();
});