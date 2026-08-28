// e2e/theme.spec.ts
import { test, expect } from './support/fixtures';

// WP-28b — theme system. The registry/validation/script are unit-tested in tests/unit/theme.test.ts;
// here we prove the picker drives <html data-theme>, and that the choice is applied at first paint on reload.
test('WP-28b: default theme is night when nothing is stored', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
});

test('WP-28b: picking a theme applies live and persists (no flash) across reload', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: /Holo panel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sci-fi');

  await page.reload();
  // Applied by the pre-paint inline script → attribute is present immediately, not after hydration.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sci-fi');
  await expect(page.getByRole('radio', { name: /Holo panel/ })).toHaveAttribute('aria-checked', 'true');
});

test('WP-28b: arrow keys move theme selection within the radiogroup (roving, wraps)', async ({ page }) => {
  await page.goto('/settings');
  // Default night is the tabbable radio; ArrowRight advances to the next theme (scroll) and applies it.
  await page.getByRole('radio', { name: /Night reading/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'scroll');
  await expect(page.getByRole('radio', { name: /Ancient scroll/ })).toHaveAttribute('aria-checked', 'true');

  // ArrowLeft from the first option wraps to the last (sci-fi).
  await page.getByRole('radio', { name: /Night reading/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sci-fi');
  await expect(page.getByRole('radio', { name: /Holo panel/ })).toHaveAttribute('aria-checked', 'true');
});
