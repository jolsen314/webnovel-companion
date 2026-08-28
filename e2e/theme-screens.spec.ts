// e2e/theme-screens.spec.ts
import { test } from './support/fixtures';
import { mkdirSync } from 'node:fs';

// Captures the empty-state screens under each theme for owner review. Not an assertion test —
// it writes PNGs to a gitignored dir. The DB is reset empty by the fixture, so `/` shows the
// empty-shelf hero (the state that never appears in prod).
const OUT = 'screenshots/wp28b';
const THEMES = ['night', 'scroll', 'sci-fi'] as const;

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

for (const theme of THEMES) {
  test(`capture empty-state screens — ${theme}`, async ({ page }) => {
    // Set the theme before first paint via the same localStorage key the pre-paint script reads.
    await page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);

    await page.goto('/');
    await page.screenshot({ path: `${OUT}/${theme}-shelf-empty.png`, fullPage: true });

    await page.goto('/settings');
    await page.screenshot({ path: `${OUT}/${theme}-settings.png`, fullPage: true });
  });
}
