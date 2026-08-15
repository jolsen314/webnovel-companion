# WP-PW — Playwright E2E harness + backfill UI coverage

**Status:** design approved 2026-08-14. Depends on WP-10 (UI, done) and WP-AUTH (done). This stands up the
Playwright E2E harness the README long deferred, then backfills automated coverage for the UI-only flows that
shipped without any (no React harness existed when they landed): WP-10, WP-30, WP-34, WP-51.

## Problem

Every UI-only feature so far (library grid + detail controls, inline title edit, the source-action buttons,
delete) shipped verified only by manual app-driving — no automated test. The WP-PW checklist tracks them so the
gap is visible; this WP closes it by building the harness and covering all four flow-groups.

## Decisions (owner, 2026-08-14)

- **Scope:** harness + **all four** flow-groups, including WP-34's network-triggering buttons via Playwright
  request stubbing.
- **Auth: gate-off.** The E2E app runs with **no `AUTH_SECRET`**, so the middleware gate is open in non-prod
  ([`middleware.ts`](../../../src/middleware.ts): `!secret && NODE_ENV !== 'production' → next()`). Tests
  navigate freely; no login step. The login flow itself is out of scope (a future checklist item).
- **`next dev`, not a prod build.** Gate-off *requires* dev mode: `next start` forces `NODE_ENV=production`,
  which fail-closes the gate when `AUTH_SECRET` is unset. So the harness serves the app via `next dev`, with
  generous Playwright timeouts + a warmup navigation to absorb dev first-hit compilation.
- **Designed for a cheap auth-aware switch later.** All E2E env lives in one `webServer.env` block; the DB
  seed/reset, fixtures, and every flow spec are auth-agnostic. A future switch = add `AUTH_SECRET` +
  `AUTH_PASSWORD_HASH` to that block, add a ~20-line `globalSetup` that `POST`s `/api/auth/login` with a known
  passphrase and saves `storageState`, and set `use.storageState` — **zero test-body changes.**
- **CI: enforced.** A new `e2e` job in `ci.yml` runs the harness on every PR (mirrors the integration job's
  Postgres service).

## Design

### 1. Harness & config

- Add dev dependency `@playwright/test`. Add `playwright.config.ts`:
  - `testDir: 'e2e'`; **chromium project only**; `retries: process.env.CI ? 2 : 0`; `timeout`/`expect.timeout`
    generous enough for dev-mode compiles (e.g. 30s/10s).
  - `use.baseURL: 'http://localhost:3100'`.
  - `webServer`: `command: 'npm run dev -- -p 3100'`, `url: 'http://localhost:3100'`,
    `reuseExistingServer: !process.env.CI`, `timeout: 120_000`, and an **`env` block** carrying the entire E2E
    environment: **no `AUTH_SECRET`** (gate open), `DATABASE_URL` → the `webnovel_e2e` DB, `WEBNOVEL_USER_ID: 'local'`.
    (This one block is the sole place a future auth-aware switch adds `AUTH_SECRET`/`AUTH_PASSWORD_HASH`.)
- `package.json`: `"test:e2e": "playwright test"`.
- `.gitignore`: `test-results/`, `playwright-report/`, `.playwright/`, `e2e/.auth/`.

### 2. E2E database + seeding

- A dedicated **`webnovel_e2e`** Postgres DB (never dev/test/prod). The test process and the app server both
  point at it via `DATABASE_URL`. Migrations applied with `prisma migrate deploy` before the run.
- `e2e/support/db.ts` — opens a `PrismaClient` (its own instance; the test process is separate from the app)
  and exports:
  - `resetDb()` — truncate every app table (dynamic `TRUNCATE … RESTART IDENTITY CASCADE`, exactly like the
    integration [`setup.ts`](../../../tests/integration/setup.ts) so new models clear automatically).
  - `seedSeries(input)` — a nested `db.series.create` mirroring the integration `addAlphaDuplicate` pattern:
    `userId: 'local'`, `title`, a `sources.create` (`url`, `host`, `type`, `matchType`/`matchValue`,
    `feedUrl?`), and `chapters.create[]` (`title`, `url`, `guid`, `access`). Returns the created series (id).
    Typed options cover what the flows need (title, chapter list, `sourceType: 'FEED' | 'PAGE_WATCH'`).
- `e2e/support/fixtures.ts` — extends Playwright `test` with a fixture that runs `resetDb()` **before each
  test**, so tests are isolated + deterministic. Seeding is done explicitly per test (each spec seeds exactly
  what it asserts on), keeping tests readable.

### 3. Flow specs (in `e2e/`)

Each seeds via `seedSeries`, drives the real UI, and asserts observable outcomes (reload where persistence
matters). Selectors reuse the existing DOM (roles + the stable class/aria hooks already in the components).

- **`delete.spec.ts` (WP-51).**
  - *Detail:* seed 1 series → `/series/{id}` → "Delete series" → "Delete forever" → assert URL is `/` and the
    series is gone from the shelf.
  - *Shelf:* seed 2 series → `/` → hover/click a card's trash (`aria-label="Delete {title}"`) → "Delete" in the
    popover → assert that card is gone and one remains.
  - *No-navigate guard:* click the trash → assert the URL stays `/` (tapping trash didn't open the series).
- **`title-edit.spec.ts` (WP-30).** Seed → `/series/{id}` → click "Edit title" (`aria-label`) → clear + type a
  new title → Save → assert the `<h1>` shows the new title → reload → still there (persisted + `titleIsManual`).
- **`controls.spec.ts` (WP-10).** Seed a series with ≥2 chapters → `/` shows the card (library grid renders) →
  `/series/{id}` → change **Status** (`<select>`), set a **Rating** star, click **mark read** on a chapter →
  reload → assert each reflects (status selected, stars filled, the chapter marked current).
- **`source-actions.spec.ts` (WP-34).** Seed a series whose active source is **FEED** (so "Track unlocks"
  renders). Use `page.route()` to **stub** `**/api/series/*/backfill` → `{ added: 3, reconciled: 1 }` and
  `**/api/series/*/switch` → `{ added: 2, fetchMode: 'PLAIN', rendered: false }`. Click "Backfill from TOC" →
  assert the result hint (`role="status"`) shows the added/updated counts. Click "Track unlocks (switch to
  TOC)" → assert its switch hint renders. The real routes/network never fire — this covers the client
  button→fetch→render-result behavior only, which is all that's deterministically testable for those buttons.

### 4. CI

- New **`e2e` job** in [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml), mirroring the
  `integration` job's Postgres service (`webnovel_e2e` DB, `DATABASE_URL` env):
  - `npm ci`; `npx playwright install --with-deps chromium`; `npx prisma migrate deploy`; `npm run test:e2e`.
  - On failure, `actions/upload-artifact` the `playwright-report/` for debugging.
  - Runs alongside `test` + `integration` (not blocking them).

### 5. Docs / bookkeeping

- Short `e2e/README.md`: how to run locally (create `webnovel_e2e`, `prisma migrate deploy` to it, `npm run
  test:e2e`), and the gate-off + `next dev` rationale.
- README "E2E (later)" note updated to reflect the harness now exists.
- PLAN.md: check off all four WP-PW checklist items; WP-PW → Completed; changelog; advance `NEXT`.

## Testing (how we know the harness works)

The harness's own deliverable *is* tests. "Green" = `npm run test:e2e` passes locally against `webnovel_e2e`
and the new `e2e` CI job passes. Each spec asserts a real user-observable outcome (not an implementation
detail), with a reload where persistence is the point. `npm test` (unit) + `npm run test:integration` +
`npm run typecheck` remain green (the harness adds no runtime code to `src/`).

## Out of scope / non-goals

- **Login/auth-flow coverage** (gate-off) — a future checklist item; the harness is structured so adding it is
  config-localized.
- **Prod-build serving** (`next start`) — unlocked only by the future auth-aware switch; not needed now.
- **Real network** for the WP-34 buttons — stubbed by design (E2E must be deterministic + offline).
- **Cross-browser** — chromium only for now (webkit/firefox can be added to the projects list later).
- No new `src/` runtime code; no changes to app behavior.

## Definition of Done

- `playwright.config.ts` + `@playwright/test` + `test:e2e` script + `.gitignore` entries in place.
- `webnovel_e2e` DB flow: `resetDb`/`seedSeries` helpers + a per-test reset fixture.
- Four specs (delete, title-edit, controls, source-actions) pass locally against `webnovel_e2e`.
- New `e2e` CI job passes (Postgres service + Playwright + migrate + run), report artifact on failure.
- Unit + integration + typecheck still green.
- PLAN.md: all four WP-PW checklist items checked; WP-PW → Completed; changelog added; `NEXT` advanced.