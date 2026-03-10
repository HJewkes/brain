import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      globalSetup: ['__tests__/setup/global-setup.ts'],
      include: [
        '__tests__/commands/**/*.test.ts',
        '__tests__/services/**/*.test.ts',
        '__tests__/modules/**/*.test.ts',
        '__tests__/utils/**/*.test.ts',
        '__tests__/adapters/**/*.test.ts',
      ],
      pool: 'forks',
      poolOptions: {
        forks: {
          maxForks: 2,
        },
      },
    },
  },
  {
    test: {
      name: 'integration',
      globalSetup: ['__tests__/setup/global-setup.ts'],
      include: ['__tests__/integration/**/*.test.ts'],
      pool: 'threads',
      poolOptions: {
        threads: {
          singleThread: true,
        },
      },
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  },
  {
    test: {
      name: 'eval',
      include: ['__tests__/eval/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          maxForks: 2,
        },
      },
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  },
]);
