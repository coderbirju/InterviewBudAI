import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Vitest config for the React SPA component/unit tests (ADR 0006 M2).
 *
 * Separate from the root node-env config: these tests need a jsdom DOM + the
 * React plugin for JSX. Globs only the web-ui test files so it never collides
 * with the root node tests.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
