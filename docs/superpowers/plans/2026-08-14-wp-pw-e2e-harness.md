# WP-PW Playwright E2E Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Playwright E2E harness (gate-off, `next dev`, dedicated `webnovel_e2e` DB) and cover the four shipped UI-only flow-groups (WP-10 controls, WP-30 title edit, WP-34 source-action buttons, WP-51 delete), enforced by a new CI job.

**Architecture:** Playwright serves the app via `next dev` on port 3100 with `AUTH_SECRET` absent (gate open in dev). A separate `PrismaClient` in the test process seeds/reset a dedicated `webnovel_e2e` DB the app also points at. Specs drive the real UI; the WP-34 buttons are covered with `page.route()` request stubs so no real network fires. A new `e2e` CI job mirrors the integration job's Postgres service.

**Tech Stack:** `@playwright/test` (chromium), Next.js App Router (`next dev`), Prisma/Postgres.

## Global Constraints

- **Gate-off requires `next dev`.** `next start` forces `NODE_ENV=production`, which fail-closes the middleware when `AUTH_SECRET` is unset. The harness must serve via `next dev`. `.env` defines no `AUTH_SECRET` (verified), so the gate is open; do NOT add `AUTH_SECRET` to the E2E env.
- **Destructive DB guard.** `resetDb()` TRUNCATEs — it must refuse unless `DATABASE_URL` names an e2e/test DB (name contains `e2e` or `test`), mirroring the integration `setup.ts` guard. Never point E2E at `webnovel_dev` or prod.
- **Deterministic + offline.** No spec may hit the real network. The only network-triggering UI (WP-34 backfill/switch) is stubbed via `page.route()`.
- **No new `src/` runtime code.** This WP adds test harness + config + CI + docs only. App behavior is unchanged.
- **Auth-agnostic tests.** Keep all env in the one `webServer.env` block; specs must not assume "no login" beyond navigating — so a future auth-aware switch is config-only.
- **Verify:** the harness's deliverable is green tests. A task that adds specs isn't done until `npm run test:e2e` passes for them locally against `webnovel_e2e`. Keep `npm test` (unit) + `npm run test:integration` + `npm run typecheck` green.
- **Commit gating:** per-task **local** commits on the `wp-pw-e2e-harness` branch (owner-approved pattern); nothing pushed until finish.
- **Anonymity:** seeds/docs use `*.example` hosts and generic names only.
- **Env prerequisite (local):** a `webnovel_e2e` Postgres DB must exist and be migrated (`createdb webnovel_e2e` or `CREATE DATABASE`, then `DATABASE_URL=…/webnovel_e2e npx prisma migrate deploy`), and chromium installed (`npx playwright install chromium`). Task 1 establishes these.

---

### Task 1: Harness foundation (config, deps, DB support, fixtures, smoke spec)

**Files:**
- Modify: `package.json` (devDep `@playwright/test`; `"test:e2e"` script)
- Create: `playwright.config.ts`
- Create: `e2e/support/db.ts`
- Create: `e2e/support/fixtures.ts`
- Create: `e2e/smoke.spec.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `resetDb()`, `seedSeries(input)` (from `e2e/support/db.ts`); `test`/`expect` (from `e2e/support/fixtures.ts`) — consumed by every later spec. `npm run test:e2e`.

- [ ] **Step 1: Install Playwright + add the script**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

In `package.json` scripts, add:

```json
    "test:e2e": "playwright test",
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // One shared webnovel_e2e DB reset per test → serialize to avoid cross-test races.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The whole E2E env lives here. Gate-off: no AUTH_SECRET. DATABASE_URL is inherited
    // from the test process (which points at webnovel_e2e) so app + test share one DB.
    // A future auth-aware switch adds AUTH_SECRET + AUTH_PASSWORD_HASH to THIS block only.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      WEBNOVEL_USER_ID: 'local',
    },
  },
});
```

- [ ] **Step 3: Create `e2e/support/db.ts` (guarded reset + seed)**

```ts
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/e2e|test/i.test(url)) {
  throw new Error(
    'E2E tests need DATABASE_URL to point at an e2e/test database (its name must contain "e2e" or "test"). ' +
      'Run e.g. DATABASE_URL="postgresql://…/webnovel_e2e" npm run test:e2e',
  );
}

export const db = new PrismaClient();

/** Truncate every app table (dynamic, so new models clear automatically) — mirrors the integration setup. */
export async function resetDb(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length > 0) {
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

export interface SeedChapter { title: string; url: string; guid?: string }
export interface SeedSeriesInput {
  title: string;
  sourceType?: 'FEED' | 'PAGE_WATCH';
  host?: string;
  chapters?: SeedChapter[];
}

/** Seed one owned series with a source + chapters, directly via Prisma (no network add flow).
 *  Mirrors the integration `addAlphaDuplicate` shape. userId 'local' matches WEBNOVEL_USER_ID. */
export async function seedSeries(input: SeedSeriesInput): Promise<{ id: string }> {
  const host = input.host ?? 'translator.example';
  const type = input.sourceType ?? 'FEED';
  const series = await db.series.create({
    data: {
      userId: 'local',
      title: input.title,
      sources: {
        create: {
          url: `https://${host}/series/${encodeURIComponent(input.title)}/`,
          host,
          type,
          ...(type === 'FEED'
            ? { feedUrl: `https://${host}/feed/`, matchType: 'WHOLE_FEED', matchValue: null }
            : {}),
        },
      },
      ...(input.chapters?.length
        ? {
            chapters: {
              create: input.chapters.map((c, i) => ({
                title: c.title,
                url: c.url,
                guid: c.guid ?? `g${i + 1}`,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return series;
}
```

> If `prisma migrate diff`/typegen reveals a required Source field beyond these (e.g. `matchType` is non-nullable with no default), set it here to match the schema — mirror `tests/integration/cleanup.test.ts` `addAlphaDuplicate` exactly.

- [ ] **Step 4: Create `e2e/support/fixtures.ts` (per-test reset)**

```ts
import { test as base } from '@playwright/test';
import { resetDb } from './db';

/** Every test starts from an empty DB (auto fixture runs before the test body). */
export const test = base.extend<{ freshDb: void }>({
  freshDb: [
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
```

- [ ] **Step 5: Create `e2e/smoke.spec.ts`**

```ts
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test('the shelf renders a seeded series', async ({ page }) => {
  await seedSeries({
    title: 'Smoke Saga',
    chapters: [{ title: 'Chapter 1', url: 'https://translator.example/smoke/c1' }],
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Smoke Saga' })).toBeVisible();
});
```

- [ ] **Step 6: `.gitignore`**

Append:

```
# Playwright E2E
/test-results/
/playwright-report/
/.playwright/
```

- [ ] **Step 7: Create the e2e DB + run the smoke test**

```bash
# Create + migrate the dedicated e2e DB (uses your local .env DATABASE_URL creds, db name swapped).
createdb webnovel_e2e 2>/dev/null || true
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//' | sed 's/webnovel_dev/webnovel_e2e/')" npx prisma migrate deploy
# Run the harness (same DATABASE_URL so app + test share the e2e DB):
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//' | sed 's/webnovel_dev/webnovel_e2e/')" npm run test:e2e
```

Expected: the smoke test passes (webServer boots `next dev` on 3100, gate open, shelf shows "Smoke Saga").

- [ ] **Step 8: Typecheck + confirm existing suites still green**

Run: `npm run typecheck` → clean. `npm test` → unit green. (Integration unaffected.)

- [ ] **Step 9: Commit** *(local only)*

```bash
git add package.json package-lock.json playwright.config.ts e2e/ .gitignore
git commit -m "WP-PW: Playwright E2E harness (gate-off next dev, webnovel_e2e seed/reset) + smoke"
```

---

### Task 2: `delete.spec.ts` (WP-51)

**Files:** Create `e2e/delete.spec.ts`

**Interfaces:** Consumes `test`/`expect` (fixtures) + `seedSeries` (Task 1).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test.describe('delete series', () => {
  test('detail delete redirects to the shelf and removes the series', async ({ page }) => {
    const { id } = await seedSeries({
      title: 'Delete Me',
      chapters: [{ title: 'C1', url: 'https://translator.example/dm/c1' }],
    });
    await page.goto(`/series/${id}`);
    await page.getByRole('button', { name: 'Delete series' }).click();
    await page.getByRole('button', { name: 'Delete forever' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Delete Me' })).toHaveCount(0);
  });

  test('shelf trash removes the card and does not navigate into the series', async ({ page }) => {
    await seedSeries({ title: 'Keep One', chapters: [{ title: 'C1', url: 'https://translator.example/k/c1' }] });
    await seedSeries({ title: 'Trash Me', chapters: [{ title: 'C1', url: 'https://translator.example/t/c1' }] });
    await page.goto('/');

    await page.getByRole('button', { name: 'Delete Trash Me' }).click();
    await expect(page).toHaveURL('/'); // trash tap must NOT open the series

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Trash Me' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Keep One' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run**

Run: `DATABASE_URL="…/webnovel_e2e" npm run test:e2e -- delete` → both tests pass.
(If the shelf trash is hover-gated and a click misses, add `await page.getByRole('button', { name: 'Delete Trash Me' }).click({ force: true });` — Playwright treats opacity:0 as visible, so a plain click usually works.)

- [ ] **Step 3: Commit** *(local only)*

```bash
git add e2e/delete.spec.ts
git commit -m "WP-PW: e2e delete flow (detail + shelf, no-navigate guard)"
```

---

### Task 3: `title-edit.spec.ts` (WP-30) + `controls.spec.ts` (WP-10)

**Files:** Create `e2e/title-edit.spec.ts`, `e2e/controls.spec.ts`

**Interfaces:** Consumes `test`/`expect` + `seedSeries`.

- [ ] **Step 1: `e2e/title-edit.spec.ts`**

```ts
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test('editing a series title persists', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Old Name',
    chapters: [{ title: 'C1', url: 'https://translator.example/tt/c1' }],
  });
  await page.goto(`/series/${id}`);

  await page.getByRole('button', { name: 'Edit title' }).click();
  const input = page.getByRole('textbox', { name: 'Series title' });
  await input.fill('New Shiny Name');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'New Shiny Name' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New Shiny Name' })).toBeVisible();
});
```

- [ ] **Step 2: `e2e/controls.spec.ts`**

```ts
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

test('library grid renders and detail controls persist', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Ctrl Series',
    chapters: [
      { title: 'Chapter 1', url: 'https://translator.example/cs/c1' },
      { title: 'Chapter 2', url: 'https://translator.example/cs/c2' },
    ],
  });

  // Library grid renders the seeded card.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ctrl Series' })).toBeVisible();

  // Detail: status, rating, mark-read.
  await page.goto(`/series/${id}`);
  await page.getByLabel('Status').selectOption('COMPLETED');
  await page.getByRole('button', { name: '3 stars' }).click();
  await page.getByRole('button', { name: 'mark read' }).first().click();

  await page.reload();
  await expect(page.getByLabel('Status')).toHaveValue('COMPLETED');
  await expect(page.getByRole('button', { name: '3 stars' })).toHaveClass(/star--on/);
  await expect(page.getByRole('button', { name: 'current' })).toBeVisible();
});
```

> Selector notes (verify against the components while implementing): the Status `<select>` is nested inside a `<label className="control">` whose text is "Status" → `getByLabel('Status')`. Rating stars are buttons with `aria-label` `"{n} star"` / `"{n} stars"`. The mark-read control's text is `mark read`, flipping to `current` for the last-read chapter (`SeriesDetail.tsx`). If `getByLabel('Status')` doesn't resolve (implicit label), fall back to `page.locator('.detail__controls select')`.

- [ ] **Step 3: Run**

Run: `DATABASE_URL="…/webnovel_e2e" npm run test:e2e -- title-edit controls` → all pass.

- [ ] **Step 4: Commit** *(local only)*

```bash
git add e2e/title-edit.spec.ts e2e/controls.spec.ts
git commit -m "WP-PW: e2e title-edit (WP-30) + library/detail controls (WP-10)"
```

---

### Task 4: `source-actions.spec.ts` (WP-34, stubbed)

**Files:** Create `e2e/source-actions.spec.ts`

**Interfaces:** Consumes `test`/`expect` + `seedSeries`. Uses `page.route()` to stub the two source-action API calls.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from './support/fixtures';
import { seedSeries } from './support/db';

// The Backfill + Track-unlocks buttons trigger routes that fetch the real network server-side.
// We stub the browser→API calls so the real routes never run; this covers the client
// button→fetch→render-result behavior (all that's deterministically testable here).

test('Backfill from TOC shows the result hint (stubbed)', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Feed Series',
    sourceType: 'FEED',
    chapters: [{ title: 'C1', url: 'https://translator.example/fs/c1' }],
  });
  await page.route(`**/api/series/${id}/backfill`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ added: 3, reconciled: 1 }) }),
  );
  await page.goto(`/series/${id}`);
  await page.getByRole('button', { name: 'Backfill from TOC' }).click();
  await expect(page.getByText('Added 3 · updated 1')).toBeVisible();
});

test('Track unlocks (switch to TOC) shows the switch hint (stubbed)', async ({ page }) => {
  const { id } = await seedSeries({
    title: 'Feed Series Two',
    sourceType: 'FEED',
    chapters: [{ title: 'C1', url: 'https://translator.example/fs2/c1' }],
  });
  await page.route(`**/api/series/${id}/switch`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ added: 2, fetchMode: 'PLAIN', rendered: false }),
    }),
  );
  await page.goto(`/series/${id}`);
  await page.getByRole('button', { name: 'Track unlocks (switch to TOC)' }).click();
  await expect(page.getByText('Switched · 2 chapters')).toBeVisible();
});
```

> The result strings come from `SeriesDetail.tsx`: backfill → `Added ${added} · updated ${reconciled}` (` · rendered` only when `rendered`); switch → `Switched · ${added} chapters`. The "Track unlocks" button only renders when the active source `type === 'FEED'` — hence `sourceType: 'FEED'`. Verify the exact strings against the component when implementing.

- [ ] **Step 2: Run**

Run: `DATABASE_URL="…/webnovel_e2e" npm run test:e2e -- source-actions` → both pass. Then run the whole suite once: `DATABASE_URL="…/webnovel_e2e" npm run test:e2e` → all specs green.

- [ ] **Step 3: Commit** *(local only)*

```bash
git add e2e/source-actions.spec.ts
git commit -m "WP-PW: e2e source-action buttons (WP-34) via request stubbing"
```

---

### Task 5: CI `e2e` job

**Files:** Modify `.github/workflows/ci.yml`

**Interfaces:** none (CI).

- [ ] **Step 1: Add the `e2e` job**

Append a new job (sibling of `test` and `integration`), mirroring the integration job's Postgres service but with `webnovel_e2e` + Playwright:

```yaml
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: webnovel_e2e
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U test"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/webnovel_e2e
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Apply migrations
        run: npx prisma migrate deploy
      - name: E2E tests (Playwright)
        run: npm run test:e2e
      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Validate the YAML**

Run: `node -e "require('js-yaml')" 2>/dev/null && npx --yes js-yaml .github/workflows/ci.yml >/dev/null && echo "yaml ok" || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: `yaml ok` (the job parses; the real run happens on push).

- [ ] **Step 3: Commit** *(local only)*

```bash
git add .github/workflows/ci.yml
git commit -m "WP-PW: CI e2e job (Postgres service + Playwright + migrate + run)"
```

---

### Task 6: Docs + PLAN bookkeeping

**Files:** Create `e2e/README.md`; Modify `README.md`, `PLAN.md`; commit the spec + this plan.

- [ ] **Step 1: `e2e/README.md`**

```markdown
# E2E tests (Playwright)

Gate-off harness: the app runs via `next dev` with **no `AUTH_SECRET`**, so the auth gate is open in dev
(`next start` can't be used — it forces production, which fail-closes the gate). Tests use a dedicated
`webnovel_e2e` Postgres DB, reset before each test.

## Run locally

    createdb webnovel_e2e   # once
    DATABASE_URL="postgresql://…/webnovel_e2e" npx prisma migrate deploy
    DATABASE_URL="postgresql://…/webnovel_e2e" npm run test:e2e

The same `DATABASE_URL` is used by both the test process (seed/reset) and the app server (via
`webServer.env` inheritance).

## Switching to auth-aware later

Add `AUTH_SECRET` + `AUTH_PASSWORD_HASH` (from `npm run auth:hash`) to `webServer.env` in
`playwright.config.ts`, add a `globalSetup` that `POST`s `/api/auth/login` and saves `storageState`, and set
`use.storageState`. Test bodies don't change.
```

- [ ] **Step 2: README.md**

Update the testing section so E2E is no longer "later": note the Playwright harness exists (`npm run test:e2e`, `e2e/`, gate-off `next dev`, `webnovel_e2e`).

- [ ] **Step 3: PLAN.md**

- Check off all four WP-PW checklist items (`- [x]`) in the `### WP-PW` detail section.
- Move WP-PW out of the active queue → append to ✅ Completed (`· WP-PW (Playwright E2E harness + WP-10/30/34/51 coverage)`).
- Set the new `NEXT` to the next active-queue row (WP-50, unless re-prioritized) and rewrite the Current-focus `NEXT:` block accordingly; prepend a WP-PW entry to "Recently landed".
- Add a Changelog entry (`- **2026-08-14** — **WP-PW done: Playwright E2E harness + UI coverage.** …`) covering: gate-off `next dev` + `webnovel_e2e` seed/reset + four flow-groups (WP-34 via request stubs) + the new CI `e2e` job + the standing "UI-only WP appends to the checklist" rule now backed by a real harness.

- [ ] **Step 4: Commit** *(local only)*

```bash
git add e2e/README.md README.md PLAN.md docs/superpowers/specs/2026-08-14-wp-pw-e2e-harness-design.md docs/superpowers/plans/2026-08-14-wp-pw-e2e-harness.md
git commit -m "docs: WP-PW done (E2E harness + coverage); checklist cleared"
```

- [ ] **Step 5: WP-boundary check-in**

Per CLAUDE.md agreement #4, stop and check in (finish action + note the harness is CI-enforced) before the next WP.

---

## Self-Review

**Spec coverage:**
- Harness (config, deps, gate-off `next dev`, `webnovel_e2e`, seed/reset, fixture) → Task 1. ✓
- WP-51 delete (detail + shelf + no-navigate) → Task 2. ✓
- WP-30 title edit → Task 3. ✓
- WP-10 library render + controls → Task 3. ✓
- WP-34 buttons via stubs → Task 4. ✓
- CI enforcement → Task 5. ✓
- Docs + checklist cleared + PLAN → Task 6. ✓

**Placeholder scan:** No TBD/TODO; full code for config, db.ts, fixtures, all four specs, the CI job, and the e2e README. Selector-verification notes point at real components, not placeholders. ✓

**Type/consistency:** `seedSeries(input): Promise<{ id }>` defined in Task 1, used with `const { id } = await seedSeries(...)` everywhere. `test`/`expect` imported from `./support/fixtures` in every spec; `seedSeries` from `./support/db`. Result strings (`Added N · updated M`, `Switched · N chapters`) match `SeriesDetail.tsx`. Port 3100 + `webnovel_e2e` consistent across config, CI, and docs. ✓

**Environment note:** Tasks 1–4 verify by running `npm run test:e2e` against a local `webnovel_e2e` DB with chromium installed (Task 1 Step 7 establishes both). A runner without a local Postgres / browser download can't go green — if blocked there, that's an environment gap to raise, not a code defect.