/* ESLint config for the InterviewBudAI monorepo.
 * TypeScript-aware, Prettier-compatible. Charter §3.3: do not weaken these
 * rules to make a build pass — fix the root cause instead.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  ignorePatterns: [
    'dist/',
    'dist-ui/',
    'node_modules/',
    'coverage/',
    '*.config.*',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // React SPA source (ADR 0006). Browser env + JSX; adds React rules
      // WITHOUT weakening the base TypeScript rules above.
      files: ['packages/web/web-ui/**/*.{ts,tsx}'],
      env: {
        browser: true,
        es2022: true,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      plugins: ['@typescript-eslint', 'react', 'react-hooks'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
        'prettier',
      ],
      settings: {
        react: { version: 'detect' },
      },
    },
    {
      // Vitest component/unit tests for the SPA. Declare the test globals
      // (globals:true in vitest.config) so no-undef does not flag them.
      files: ['packages/web/web-ui/**/*.test.{ts,tsx}'],
      env: {
        browser: true,
        es2022: true,
      },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  ],
};
