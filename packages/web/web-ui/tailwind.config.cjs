/** @type {import('tailwindcss').Config} */
// Design tokens (ADR 0006 D1/D2) as theme extensions so later pages reuse them.
// Tailwind is compiled to a static CSS file at build time — no runtime/CDN.
const path = require('node:path');
module.exports = {
  // Absolute globs (resolved from this config's dir) so purge finds the JSX
  // regardless of Vite's working directory.
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        // Accent (emerald) — slate palette ships with Tailwind by default.
        accent: {
          DEFAULT: '#22c55e', // emerald-500
        },
        // Per-problem note status colors.
        status: {
          done: '#22c55e', // green — done
          revisit: '#f59e0b', // amber — to_revisit
          blocked: '#ef4444', // red — did_not_understand
        },
        // Problem difficulty colors.
        difficulty: {
          easy: '#22c55e', // green
          medium: '#f59e0b', // amber
          hard: '#ef4444', // red
        },
      },
    },
  },
  plugins: [],
};
