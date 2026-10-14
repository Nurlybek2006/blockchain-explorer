import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.spec.ts', 'e2e/**/*.spec.ts'],
    globalSetup: './helpers/global-setup.ts',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
