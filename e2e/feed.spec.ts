import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

// WP-28c — the digest at / lists readable new-chapter events across READING series,
// excludes locked chapters and non-reading series, and tabs to the shelf.
test('WP-28c: feed lists readable new chapters, excludes locked + non-reading', async ({ page }) => {
  await seedSeries({
    title: 'Reading One',
    status: 'READING',
    chapters: [
      { title: 'free-a', url: 'https://ex.test/r/1', access: 'FREE', announced: true },
      { title: 'free-b', url: 'https://ex.test/r/2', access: 'FREE', announced: true },
      { title: 'locked-c', url: 'https://ex.test/r/3', access: 'LOCKED', announced: true },
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
  await seedSeries({ title: 'Reading One', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/r/1', announced: true }] });

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

test('WP-28c: adding a series lands on /shelf with the new card highlighted (through the add flow)', async ({ page }) => {
  // A real series on the shelf; stub the add POST to resolve to it (E2E has no external network).
  const { id } = await seedSeries({ title: 'Added Via Flow', status: 'READING', chapters: [{ title: 'c', url: 'https://ex.test/av/1' }] });
  await page.route('**/api/series', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ seriesId: id, title: 'Added Via Flow', sourceType: 'FEED', chapters: 1, alreadyExisting: false }),
    }),
  );

  await page.goto('/add');
  await page.getByRole('textbox').first().fill('https://ex.test/av/');
  await page.getByRole('button', { name: 'Add series' }).click();

  // The add flow itself redirected to the shelf with ?added, and that drives the highlight.
  await expect(page).toHaveURL(`/shelf?added=${id}`);
  await expect(page.locator(`#series-${id}`)).toHaveClass(/card-wrap--added/);
});

test('WP-28c: ?added scrolls the target card into view when it would be below the fold', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // 15 series with recent chapters sort above; the target has no chapters, so 'recent' sorts it last.
  for (let i = 0; i < 15; i++) {
    await seedSeries({ title: `Filler ${String(i).padStart(2, '0')}`, status: 'READING', chapters: [{ title: 'c', url: `https://ex.test/fill/${i}` }] });
  }
  const { id } = await seedSeries({ title: 'Way Down Below', status: 'READING' }); // no chapters → last

  await page.goto(`/shelf?added=${id}`);
  const card = page.locator(`#series-${id}`);
  await expect(card).toHaveClass(/card-wrap--added/);
  // Without the scrollIntoView this card would be far below the fold; toBeInViewport proves it scrolled.
  await expect(card).toBeInViewport();
});

test('WP-28c: ?added does not scroll when a saved filter hides the new series', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // Saved filter = Planned only (set before load). The new series is READING → the filter hides it,
  // so we must NOT scroll to where it briefly sat in the pre-hydration default (unfiltered) render.
  await page.addInitScript(() => window.localStorage.setItem('shelfStatus', 'PLANNED'));
  for (let i = 0; i < 15; i++) {
    await seedSeries({ title: `Planned ${String(i).padStart(2, '0')}`, status: 'PLANNED', chapters: [{ title: 'c', url: `https://ex.test/pl/${i}` }] });
  }
  // No chapters → under 'recent' it sorts LAST, i.e. below the fold in the pre-hydration render,
  // so the old buggy scroll would jump to the bottom before the filter removed it.
  const { id } = await seedSeries({ title: 'New Reading', status: 'READING' });

  await page.goto(`/shelf?added=${id}`);
  await expect(page.locator(`#series-${id}`)).toHaveCount(0); // hidden by the Planned filter
  await expect(page.locator('.card__title').first()).toBeVisible(); // shelf rendered
  await page.waitForTimeout(600); // let any (buggy) smooth-scroll settle
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50); // stayed at the top
});
