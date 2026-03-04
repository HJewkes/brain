import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
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
          maxForks: 4,
        },
      },
    },
  },
  {
    test: {
      name: 'integration',
      include: ['__tests__/integration/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
      testTimeout: 60_000,
    },
  },
  {
    test: {
      name: 'eval',
      include: ['__tests__/eval/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
      testTimeout: 60_000,
    },
  },
]);
