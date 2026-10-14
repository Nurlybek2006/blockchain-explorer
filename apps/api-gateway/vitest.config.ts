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
        'src/modules/auth/{auth,token,password}.service.ts': { statements: 85, branches: 75, functions: 90, lines: 85 },
        'src/common/security/{http-security,http-security.config,security-rate-limit.service}.ts': { statements: 85, branches: 70, functions: 80, lines: 85 },
      },
    },
  },
});
