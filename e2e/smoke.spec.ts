import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test('the shelf renders a seeded series', async ({ page }) => {
  await seedSeries({
    title: 'Smoke Saga',
    chapters: [{ title: 'Chapter 1', url: 'https://translator.example/smoke/c1' }],
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Smoke Saga' })).toBeVisible();
});