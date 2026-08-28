// e2e/theme-screens.spec.ts
import { test, expect } from './support/fixtures';
import { mkdirSync } from 'node:fs';

// Captures the empty-state screens under each theme for owner review. Not an assertion test —
// it writes PNGs to a gitignored dir. The DB is reset empty by the fixture, so `/` shows the
// empty-shelf hero (the state that never appears in prod).
const OUT = 'screenshots/wp28b';
const THEMES = ['night', 'scroll', 'sci-fi'] as const;
const LABEL: Record<(typeof THEMES)[number], string> = {
  night: 'Night reading',
  scroll: 'Ancient scroll',
  'sci-fi': 'Holo panel',
};

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

for (const theme of THEMES) {
  test(`capture empty-state screens — ${theme}`, async ({ page }) => {
    // `.themeCard` animates border-color over 180ms (globals.css), so a screenshot taken the
    // instant aria-checked flips can catch the picker mid-transition (stale card still fading
    // out, correct card still fading in). Force reduced motion so the app's own
    // `@media (prefers-reduced-motion: reduce)` rule (globals.css) zeroes that transition and
    // the capture reflects the settled, correct state.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Set the theme before first paint via the same localStorage key the pre-paint script reads.
    await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `${OUT}/${theme}-shelf-empty.png`, fullPage: true });

    await page.goto('/settings');
    await expect(page.getByRole('radio', { name: LABEL[theme] })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await page.screenshot({ path: `${OUT}/${theme}-settings.png`, fullPage: true });
  });
}
