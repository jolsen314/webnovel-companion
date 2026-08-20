import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';
import { actAndWaitForSeriesPatch } from './support/actions';

// Long enough that the collapsed preview must ellipsis-truncate it (the .notes__preview
// nowrap clip). The full text still round-trips through save/reload and stays in the DOM;
// only the rendering is clipped, which the test verifies via scrollWidth > clientWidth.
const LONG_NOTE =
  'Slow burn, MC is a chef. Skipped the tournament arc around #40 — pick back up at the ' +
  'return to the capital. Translation quality dips badly after the group change; re-read the ' +
  'earlier volumes before the finale.';

test('notes: collapsed-when-empty, save on blur, persist, open-when-present, preview truncates', async ({
  page,
}) => {
  const { id } = await seedSeries({
    title: 'Notes Series',
    chapters: [{ title: 'Chapter 1', url: 'https://translator.example/ns/c1' }],
  });
  await page.goto(`/series/${id}`);

  const toggle = page.getByRole('button', { name: 'Notes' });
  const area = page.getByRole('textbox', { name: 'Series notes' });

  // Empty series → collapsed by default; the textarea isn't shown.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(area).toBeHidden();

  // Expand, type, and blur — blur fires the fire-and-forget PATCH, so wait for it to persist.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await area.fill(LONG_NOTE);
  await actAndWaitForSeriesPatch(page, id, () => area.blur());
  await expect(page.getByText('Saved')).toBeVisible();

  // Reload: the full note persisted, and because the series now has notes it defaults to open.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('textbox', { name: 'Series notes' })).toHaveValue(LONG_NOTE);

  // Collapse → the one-line preview appears with the full note text intact...
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.getByRole('textbox', { name: 'Series notes' })).toBeHidden();
  const preview = page.locator('.notes__preview');
  await expect(preview).toHaveText(LONG_NOTE);
  // ...but is visually truncated: its content is wider than the box that renders it.
  const clipped = await preview.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
});
