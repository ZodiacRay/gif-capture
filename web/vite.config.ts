import { defineConfig } from 'vitest/config';

// Relative base so the site works from any sub-path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
