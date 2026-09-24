import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Vite build for the @ibai/web React SPA (ADR 0006).
 *
 * - `base: '/app/'` — the server serves the SPA under the /app route, so all
 *   emitted asset URLs are prefixed with /app/ (local, same-origin).
 * - `build.outDir` — emits to packages/web/dist-ui (SEPARATE from the server's
 *   tsc `dist/` output so both builds coexist).
 * - No dev server / proxy config is used at runtime: the built static bundle is
 *   served by the existing Node server. Local-first, no runtime network.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist-ui', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
