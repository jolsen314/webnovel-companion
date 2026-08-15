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