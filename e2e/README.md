# E2E tests (Playwright)

Gate-off harness: the app runs via `next dev` with **no `AUTH_SECRET`**, so the auth gate is open in dev
(`next start` can't be used — it forces production, which fail-closes the gate). Tests use a dedicated
`webnovel_e2e` Postgres DB, reset before each test. Chromium only.

## Run locally

    createdb webnovel_e2e   # once
    DATABASE_URL="postgresql://…/webnovel_e2e" npx prisma migrate deploy
    DATABASE_URL="postgresql://…/webnovel_e2e" npm run test:e2e

The same `DATABASE_URL` is used by both the test process (seed/reset in `support/db.ts`) and the app server
(via `webServer.env` inheritance in `playwright.config.ts`), so they share one DB. `support/db.ts` refuses to
run unless the DB name contains `e2e`/`test`, so it can never truncate dev or prod.

## What's covered

- `smoke.spec.ts` — the shelf renders a seeded series.
- `delete.spec.ts` — WP-51: detail delete → shelf redirect; shelf trash → card removed without navigating;
  Cancel guards on both surfaces.
- `title-edit.spec.ts` — WP-30: edit title → save → persists on reload.
- `controls.spec.ts` — WP-10: library grid renders; chapters render as clickable links; Status/Rating/mark-read persist.
- `source-actions.spec.ts` — WP-34: Backfill / Track-unlocks buttons fire and surface their result. These two
  routes fetch the real network server-side, so the browser→API call is **stubbed** (`page.route()`); the
  server-side add/reconcile logic is owned by the integration tests.

## Switching to auth-aware later

Add `AUTH_SECRET` + `AUTH_PASSWORD_HASH` (from `npm run auth:hash`) to `webServer.env` in
`playwright.config.ts`, add a `globalSetup` that `POST`s `/api/auth/login` and saves `storageState`, and set
`use.storageState`. Test bodies don't change.
