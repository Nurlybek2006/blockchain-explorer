import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': new URL('../apps/web/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1') } },
  test: { include: ['contracts/**/*.spec.ts'], fileParallelism: false },
});
