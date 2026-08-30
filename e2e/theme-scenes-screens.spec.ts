// e2e/theme-scenes-screens.spec.ts
//
// Owner-review screenshots for WP-28h — the real app, every scroll/sci-fi surface, captured
// SEPARATELY (never the spike's composite layout; see "Surface mapping" in the WP-28h plan).
// Not an assertion test in the usual sense — it writes PNGs to a gitignored dir for the owner
// to eyeball before push. The visible `expect`s just gate the screenshot on the page actually
// having settled (no fixed sleeps).
//
// Every surface is captured at TWO viewports (the app is used mostly from a phone):
//   desktop (default ~1280px, `fullPage`) → `<theme>-<screen>.png`
//   mobile  (390×844, viewport-height)    → `<theme>-<screen>-mobile.png`
// Mobile uses a viewport-height capture (not fullPage): the scene is a `position:fixed`
// backdrop, and a viewport-height shot is both what the phone actually shows AND the honest
// frame for judging tree crowding / petal-binary density on the primary device.
//
// Two passes, same file, gated by whether NEXT_PUBLIC_THEME_ASSET_BASE reached the test process
// (it's inherited from the shell that launched `npm run test:e2e`, same as it reaches the
// `next dev` webServer — see playwright.config.ts):
//   MAIN pass  (asset base set, e.g. `/themes`):    tree + wax-seal load → describe below runs,
//                                                    fallback describe is skipped.
//   FALLBACK pass (asset base unset/unreachable):    scroll hero has no tree, card badge is the
//                                                    red-circle `--noseal`, not the wax image →
//                                                    fallback describe runs, main is skipped.
import { test, expect } from './support/fixtures';
import type { Page } from '@playwright/test';
import { seedSeries } from './support/db';
import { mkdirSync } from 'node:fs';

const OUT = 'screenshots/wp28h';
const ASSET_BASE_SET = Boolean(process.env.NEXT_PUBLIC_THEME_ASSET_BASE);
const THEMES = ['scroll', 'sci-fi'] as const;

/** Desktop = default viewport + fullPage; mobile = phone viewport, viewport-height capture. */
const VIEWS = [
  { suffix: '', mobile: false },
  { suffix: '-mobile', mobile: true },
] as const;
type View = (typeof VIEWS)[number];
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

/** Set the theme before first paint via the same localStorage key the pre-paint script reads. */
function setTheme(page: Page, theme: string) {
  return page.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
}

/** Size the page for the view (mobile shrinks the viewport; desktop keeps the config default). */
async function applyView(page: Page, view: View) {
  if (view.mobile) await page.setViewportSize(MOBILE_VIEWPORT);
}

/** Capture full page on desktop; viewport-height on mobile (see header note on the fixed scene). */
function shot(page: Page, theme: string, screen: string, view: View) {
  return page.screenshot({ path: `${OUT}/${theme}-${screen}${view.suffix}.png`, fullPage: !view.mobile });
}

test.describe('main pass — asset base set (NEXT_PUBLIC_THEME_ASSET_BASE=/themes)', () => {
  test.skip(!ASSET_BASE_SET, 'run with NEXT_PUBLIC_THEME_ASSET_BASE=/themes for the main pass');

  for (const theme of THEMES) {
    for (const view of VIEWS) {
      test(`empty hero / — ${theme}${view.suffix}`, async ({ page }) => {
        // freshDb (auto fixture) resets to 0 series, so `/` renders the EmptyState hero — the
        // hero and the populated shelf are mutually exclusive states of the same route.
        await applyView(page, view);
        await setTheme(page, theme);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: /quiet in here/i })).toBeVisible();
        await shot(page, theme, 'hero', view);
      });

      test(`populated shelf / — ${theme}${view.suffix}`, async ({ page }) => {
        // Seed WITH chapters so `unread > 0` and the wax badge (or its themed equivalent) renders.
        await seedSeries({
          title: `${theme} Shelf One`,
          chapters: [
            { title: 'Chapter 1', url: 'https://translator.example/shelf1/c1' },
            { title: 'Chapter 2', url: 'https://translator.example/shelf1/c2' },
          ],
        });
        await seedSeries({
          title: `${theme} Shelf Two`,
          chapters: [{ title: 'Chapter 1', url: 'https://translator.example/shelf2/c1' }],
        });
        await applyView(page, view);
        await setTheme(page, theme);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: `${theme} Shelf One` })).toBeVisible();
        await expect(page.locator('.card__unread').first()).toBeVisible();
        await shot(page, theme, 'shelf', view);
      });

      test(`settings — ${theme}${view.suffix}`, async ({ page }) => {
        // Force reduced motion: the themeCard border-color transition (wp28b) can catch a
        // screenshot mid-fade otherwise (see theme-screens.spec.ts precedent).
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await applyView(page, view);
        await setTheme(page, theme);
        await page.goto('/settings');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
        await shot(page, theme, 'settings', view);
      });

      test(`login — ${theme}${view.suffix}`, async ({ page }) => {
        await applyView(page, view);
        await setTheme(page, theme);
        await page.goto('/login');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: /enter your passphrase/i })).toBeVisible();
        await shot(page, theme, 'login', view);
      });

      test(`series detail — ${theme}${view.suffix}`, async ({ page }) => {
        const { id } = await seedSeries({
          title: `${theme} Detail Series`,
          chapters: [
            { title: 'Chapter 1', url: 'https://translator.example/detail/c1' },
            { title: 'Chapter 2', url: 'https://translator.example/detail/c2', access: 'LOCKED' },
          ],
        });
        await applyView(page, view);
        await setTheme(page, theme);
        await page.goto(`/series/${id}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: `${theme} Detail Series` })).toBeVisible();
        await shot(page, theme, 'detail', view);
      });

      test(`add — ${theme}${view.suffix}`, async ({ page }) => {
        await applyView(page, view);
        await setTheme(page, theme);
        await page.goto('/add');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: /paste a series url/i })).toBeVisible();
        await shot(page, theme, 'add', view);
      });
    }
  }

  // The hero `em` de-emphasis (italic amber → plain) is the ONE night-visible change in this WP —
  // the owner must sign off on it, hence this small addition beyond the scroll/sci-fi matrix.
  for (const view of VIEWS) {
    test(`night empty hero / — hero de-emphasis sign-off${view.suffix}`, async ({ page }) => {
      await applyView(page, view);
      await setTheme(page, 'night');
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
      await expect(page.getByRole('heading', { name: /quiet in here/i })).toBeVisible();
      await shot(page, 'night', 'hero', view);
    });
  }
});

test.describe('fallback pass — asset base unset/unreachable', () => {
  test.skip(ASSET_BASE_SET, 'run with NEXT_PUBLIC_THEME_ASSET_BASE unset for the fallback pass');

  for (const view of VIEWS) {
    test(`scroll hero — no tree image (graceful degradation)${view.suffix}`, async ({ page }) => {
      await applyView(page, view);
      await setTheme(page, 'scroll');
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'scroll');
      await expect(page.getByRole('heading', { name: /quiet in here/i })).toBeVisible();
      await expect(page.locator('.themeScene__tree')).toHaveCount(0);
      await shot(page, 'scroll', 'hero-fallback', view);
    });

    test(`scroll card — red-circle badge, not wax seal (graceful degradation)${view.suffix}`, async ({ page }) => {
      await seedSeries({
        title: 'Fallback Series',
        chapters: [{ title: 'Chapter 1', url: 'https://translator.example/fallback/c1' }],
      });
      await applyView(page, view);
      await setTheme(page, 'scroll');
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'scroll');
      await expect(page.getByRole('heading', { name: 'Fallback Series' })).toBeVisible();
      await expect(page.locator('.card__unread--noseal')).toBeVisible();
      await expect(page.locator('.card__unread--seal')).toHaveCount(0);
      await shot(page, 'scroll', 'card-fallback', view);
    });
  }
});
