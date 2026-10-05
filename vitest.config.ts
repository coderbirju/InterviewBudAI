import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Discover *.test.ts across all packages, plus repo scripts' *.test.mjs (ADR 0016).
    include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
