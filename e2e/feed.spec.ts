import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

// WP-28c — the digest at / lists readable new-chapter events across READING series,
// excludes locked chapters and non-reading series, and tabs to the shelf.
test('WP-28c: feed lists readable new chapters, excludes locked + non-reading', async ({ page }) => {
  await seedSeries({
    title: 'Reading One',
    status: 'READING',
    chapters: [
      { title: 'free-a', url: 'https://ex.test/r/1', access: 'FREE' },
      { title: 'free-b', url: 'https://ex.test/r/2', access: 'FREE' },
      { title: 'locked-c', url: 'https://ex.test/r/3', access: 'LOCKED' },
    ],
  });
  await seedSeries({
    title: 'Completed One',
    status: 'COMPLETED',
    chapters: [{ title: 'done', url: 'https://ex.test/c/1', access: 'FREE' }],
  });

  await page.goto('/');
  const titles = page.locator('.feed-row__title');
  await expect(titles).toHaveText(['free-a', 'free-b']); // no locked, no completed-series chapter

  // Row body links out to the chapter to read; the series name links to detail.
  await expect(page.locator('.feed-row__main').first()).toHaveAttribute('href', 'https://ex.test/r/1');
  await expect(page.locator('.feed-row__series').first()).toHaveText('Reading One');
});

test('WP-28c: tabs switch between the feed and the shelf', async ({ page }) => {
  await seedSeries({ title: 'Reading One', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/r/1' }] });

  await page.goto('/');
  await expect(page.locator('.feed-row__title')).toHaveCount(1);
  await page.getByRole('link', { name: 'Shelf' }).click();
  await expect(page).toHaveURL(/\/shelf$/);
  await expect(page.locator('.card__title')).toHaveText(['Reading One']);
  await page.getByRole('link', { name: 'What’s new' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('WP-28c: shelf card shows a chapter count and hides unread on non-reading', async ({ page }) => {
  await seedSeries({
    title: 'Planned Two',
    status: 'PLANNED',
    chapters: [{ title: 'c1', url: 'https://ex.test/p/1' }, { title: 'c2', url: 'https://ex.test/p/2' }],
  });
  await page.goto('/shelf');
  await expect(page.locator('.card__count')).toHaveText('2 chapters');
  await expect(page.locator('.card__unread')).toHaveCount(0); // non-READING → no unread badge
  await expect(page.locator('.card__latest')).toHaveCount(0); // latest-chapter line removed
});

test('WP-28c: ?added highlights the target shelf card', async ({ page }) => {
  const { id } = await seedSeries({ title: 'Fresh Add', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/f/1' }] });
  await page.goto(`/shelf?added=${id}`);
  await expect(page.locator(`#series-${id}`)).toHaveClass(/card-wrap--added/);
});
