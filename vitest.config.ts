import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    // vitest 3.x reads poolOptions only from the root, so the cap lives here
    pool: 'threads',
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
    teardownTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 40,
        branches: 80,
        functions: 75,
      },
    },
  },
});
