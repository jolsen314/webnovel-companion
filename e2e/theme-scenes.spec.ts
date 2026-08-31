// e2e/theme-scenes.spec.ts
//
// WP-28h Task 8 — real assertion coverage (not screenshots) for the per-theme scene layers,
// the wax/red-circle unread badge, and the HYDRATION-CLEAN guarantee. `theme-scenes-screens.spec.ts`
// captures PNGs for owner eyeballing; this file is the automated gate that actually fails CI if a
// scene layer regresses or a hydration mismatch creeps back in.
//
// Asset-base gating mirrors theme-scenes-screens.spec.ts: NEXT_PUBLIC_THEME_ASSET_BASE is inherited
// from the shell into both this test process and the `next dev` webServer (playwright.config.ts).
// The MAIN run (owner's `npm run test:e2e`) sets it to `/themes`, so the wax-seal badge assertion
// below targets `--seal`; the `--noseal` fallback is asserted only when the base is unset.
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

const ASSET_BASE_SET = Boolean(process.env.NEXT_PUBLIC_THEME_ASSET_BASE);

/** Set the theme before first paint via the same localStorage key the pre-paint script reads. */
function setTheme(page: import('@playwright/test').Page, theme: string) {
  return page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
}

test.describe('WP-28h: night — no scene layers render', () => {
  test('night hero renders neither petals nor binary bits', async ({ page }) => {
    // freshDb (auto fixture) resets to 0 series, so `/` renders the empty-shelf hero — the
    // surface ThemeScene mounts into.
    await setTheme(page, 'night');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await expect(page.getByRole('heading', { name: /quiet in here/i })).toBeVisible();
    // ThemeScene returns null outright for night — assert both other themes' layers are absent.
    await expect(page.locator('.themeScene__petal')).toHaveCount(0);
    await expect(page.locator('.themeScene__bit')).toHaveCount(0);
  });
});

test.describe('WP-28h: scroll — petals + wax badge', () => {
  test('scroll hero renders petal layer', async ({ page }) => {
    await setTheme(page, 'scroll');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'scroll');
    await expect(page.getByRole('heading', { name: /quiet in here/i })).toBeVisible();
    await expect(page.locator('.themeScene__petal').first()).toBeVisible();
  });

  test('scroll shelf card shows the unread badge', async ({ page }) => {
    // Seed WITH chapters so `unread > 0` and the wax badge (or its red-circle fallback) renders.
    await seedSeries({
      title: 'Scroll Badge Series',
      chapters: [
        { title: 'Chapter 1', url: 'https://translator.example/scrollbadge/c1' },
        { title: 'Chapter 2', url: 'https://translator.example/scrollbadge/c2' },
      ],
    });
    await setTheme(page, 'scroll');
    await page.goto('/shelf');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'scroll');
    await expect(page.getByRole('heading', { name: 'Scroll Badge Series' })).toBeVisible();

    if (ASSET_BASE_SET) {
      // MAIN run — tree + wax-seal assets reachable, WaxBadge renders the seal image.
      await expect(page.locator('.card__unread--seal')).toBeVisible();
      await expect(page.locator('.card__unread--noseal')).toHaveCount(0);
    } else {
      // Fallback run — asset base unset, WaxBadge degrades to the plain red-circle count.
      await expect(page.locator('.card__unread--noseal')).toBeVisible();
      await expect(page.locator('.card__unread--seal')).toHaveCount(0);
    }
  });
});

test.describe('WP-28h: sci-fi — binary bits + glitch overlay', () => {
  test('sci-fi hero renders binary bits and the glitch overlay', async ({ page }) => {
    await setTheme(page, 'sci-fi');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sci-fi');
    await expect(page.getByRole('heading', { name: /quiet in here/i })).toBeVisible();
    await expect(page.locator('.themeScene__bit').first()).toBeVisible();
    await expect(page.locator('.themeScene__glitch')).toBeVisible();
  });
});

test.describe('WP-28h: HYDRATION-CLEAN guarantee', () => {
  test('no hydration-mismatch console/page errors on /settings load (non-night theme)', async ({ page }) => {
    // Collectors registered BEFORE navigation so nothing logged during the initial load/hydrate
    // is missed. React logs hydration mismatches to console.error with the word "hydration".
    const consoleTexts: string[] = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    const pageErrorTexts: string[] = [];
    page.on('pageerror', (err) => pageErrorTexts.push(err.message));

    await setTheme(page, 'scroll'); // any NON-night saved theme exercises the ThemeScene client mount
    await page.goto('/settings');

    // Wait for the settled page: pre-paint attribute present, and the client-hydrated radiogroup
    // has picked up the stored theme (proves hydration completed, not just that paint happened).
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'scroll');
    await expect(page.getByRole('radio', { name: /Ancient scroll/ })).toHaveAttribute('aria-checked', 'true');

    const hydrationConsole = consoleTexts.filter((t) => /hydrat/i.test(t));
    const hydrationErrors = pageErrorTexts.filter((t) => /hydrat/i.test(t));
    expect(hydrationConsole, `hydration-related console messages: ${JSON.stringify(consoleTexts)}`).toEqual([]);
    expect(hydrationErrors, `hydration-related page errors: ${JSON.stringify(pageErrorTexts)}`).toEqual([]);
  });
});
