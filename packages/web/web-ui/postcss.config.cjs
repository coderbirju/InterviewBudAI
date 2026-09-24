// PostCSS pipeline for the SPA: Tailwind (compiled to static CSS) + autoprefixer.
// The Tailwind config path is passed explicitly so it is found regardless of
// Vite's working directory (Vite runs with root=web-ui but PostCSS/Tailwind
// otherwise auto-discover from process.cwd()).
const path = require('node:path');
module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.cjs') },
    autoprefixer: {},
  },
};
