import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Discover *.test.ts across all packages.
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
