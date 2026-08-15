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