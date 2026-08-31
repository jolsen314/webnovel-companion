import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';
import { actAndWaitForSeriesPatch } from './support/actions';

test('library grid renders and detail controls persist', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Ctrl Series',
    chapters: [
      { title: 'Chapter 1', url: 'https://translator.example/cs/c1' },
      { title: 'Chapter 2', url: 'https://translator.example/cs/c2' },
    ],
  });

  // Library grid renders the seeded card.
  await page.goto('/shelf');
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

  // No chapter is locked here, so the WP-28d hide-locked toggle isn't offered (clutter guard).
  await expect(page.getByRole('checkbox', { name: 'Hide locked' })).toHaveCount(0);

  // Detail controls: status, rating, mark-read. Each fires a fire-and-forget PATCH with an
  // optimistic UI update, so wait for the server to persist each one before reloading —
  // otherwise the reload can race the last write and read the pre-write row.
  await actAndWaitForSeriesPatch(page, id, () => page.getByLabel('Status').selectOption('COMPLETED'));
  await actAndWaitForSeriesPatch(page, id, () => page.getByRole('button', { name: '3 stars' }).click());
  await actAndWaitForSeriesPatch(page, id, () => page.getByRole('button', { name: 'mark read' }).first().click());

  await page.reload();
  await expect(page.getByLabel('Status')).toHaveValue('COMPLETED');
  await expect(page.getByRole('button', { name: '3 stars' })).toHaveClass(/star--on/);
  await expect(page.getByRole('button', { name: 'current' })).toBeVisible();
});

test('WP-28d: locked chapters show a lock marker and the hide-locked toggle filters + persists', async ({
  page,
}) => {
  const { id } = await seedSeries({
    title: 'Locked Series',
    chapters: [
      { title: 'Free Chapter', url: 'https://translator.example/ls/c1', access: 'FREE' },
      { title: 'Locked Chapter', url: 'https://translator.example/ls/c2', access: 'LOCKED' },
    ],
  });

  await page.goto(`/series/${id}`);

  const lockedRow = page.locator('.chapter', { hasText: 'Locked Chapter' });
  const freeRow = page.locator('.chapter', { hasText: 'Free Chapter' });

  // The locked chapter carries a lock marker; the free one does not.
  await expect(lockedRow.locator('.chapter__lock')).toBeVisible();
  await expect(freeRow.locator('.chapter__lock')).toHaveCount(0);

  // Hide-locked toggle is offered (there's a locked chapter) and filters the row out.
  const hideLocked = page.getByRole('checkbox', { name: 'Hide locked' });
  await expect(hideLocked).not.toBeChecked();
  await hideLocked.check();
  await expect(lockedRow).toHaveCount(0);
  await expect(freeRow).toBeVisible();

  // Preference persists across reloads (localStorage), like the display-mode toggle.
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Hide locked' })).toBeChecked();
  await expect(page.locator('.chapter', { hasText: 'Locked Chapter' })).toHaveCount(0);
});