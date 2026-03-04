import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    passWithNoTests: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: isCI,
        maxForks: isCI ? 1 : 4,
      },
    },
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
