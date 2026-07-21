import { defineConfig } from 'vitest/config';

// Two projects, per the README testing plan:
//   - unit:        fast, pure logic in src/lib (parallel)
//   - integration: API routes vs a real test Postgres, serialized so DB state can't race
// Only `unit` has tests today; `integration` is declared so the split exists from day one.
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/integration/setup.ts'],
          // Serialize: all integration files share one worker so DB state can't race.
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
