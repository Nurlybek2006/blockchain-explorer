import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: {
        'src/workers/outbox-publisher.worker.ts': { statements: 90, branches: 60, functions: 95, lines: 90 },
        'src/modules/chain-sync/block-processor.service.ts': { statements: 55, branches: 30, functions: 70, lines: 55 },
        'src/modules/advanced/{trace-normalizer,contract-detection.service,etherscan.client}.ts': { statements: 85, branches: 80, functions: 90, lines: 85 },
      },
    },
  },
});
