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
          // Serialize: run integration files one at a time in a single worker so
          // shared test-DB state can't race. Vitest 4 removed `poolOptions`
          // (its settings became top-level), so `forks.singleFork` is now
          // expressed as maxWorkers:1 + fileParallelism:false.
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
    ],
  },
});
