import { test, expect } from './support/fixtures';

test('a no-chapters add offers a link-only confirm, and Add anyway creates the entry', async ({ page }) => {
  await page.goto('/add');

  // First POST → needsConfirm (stub, so no real network).
  await page.route('**/api/series', async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as { allowLinkOnly?: boolean; title?: string };
    if (body.allowLinkOnly) {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ seriesId: 's1', title: body.title, sourceType: 'PAGE_WATCH', chapters: 0, alreadyExisting: false }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ needsConfirm: true, reason: 'no-chapters', suggestedTitle: 'Some Page', url: 'https://plain.example/x/' }),
      });
    }
  });

  await page.getByRole('textbox').first().fill('https://plain.example/x/');
  await page.getByRole('button', { name: 'Add series' }).click();

  // Confirm panel appears with the no-chapters message + editable title.
  await expect(page.getByText(/couldn’t find a chapter list/i)).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Some Page');

  await page.getByRole('button', { name: 'Add anyway' }).click();
  await expect(page).toHaveURL('/'); // landed on the shelf after the confirmed add
});

test('Cancel on the no-chapters confirm returns to the plain add form (no add happens)', async ({ page }) => {
  await page.goto('/add');

  // Only the first (non-confirm) POST is expected here — allowLinkOnly should never be sent.
  await page.route('**/api/series', async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as { allowLinkOnly?: boolean };
    if (body.allowLinkOnly) {
      throw new Error('Cancel flow should never send allowLinkOnly');
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ needsConfirm: true, reason: 'no-chapters', suggestedTitle: 'Some Page', url: 'https://plain.example/x/' }),
    });
  });

  await page.getByRole('textbox').first().fill('https://plain.example/x/');
  await page.getByRole('button', { name: 'Add series' }).click();

  await expect(page.getByText(/couldn’t find a chapter list/i)).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();

  // Back on the plain add form: confirm panel gone, URL input visible again, still on /add.
  await expect(page.getByText(/couldn’t find a chapter list/i)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add series' })).toBeVisible();
  await expect(page).toHaveURL('/add');
});
