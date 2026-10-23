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
      exclude: ['src/**/*.spec.ts', 'src/**/*.fixtures.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: {
        'src/modules/analytics/{valuation.math,analytics.service}.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/modules/analytics/{pnl.math,pnl.service}.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/modules/portfolios/portfolios.service.ts': { statements: 75, branches: 70, functions: 90, lines: 80 },
        'src/modules/alerts/alerts.service.ts': { statements: 80, branches: 75, functions: 90, lines: 85 },
      },
    },
  },
});
