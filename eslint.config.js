import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Flat config: spread plugin configs (no "extends" with objects).
// react-hooks: use recommended-latest for flat config; plugin has no .flat.recommended.
export default defineConfig([
  globalIgnores(['node_modules', 'dist', 'data', 'test-background-scan.js', 'verify-industry-accuracy.js']),
  js.configs.recommended,
  // TypeScript + React: src only (server/scripts use node globals only, no TS rules)
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['src/**/*.{ts,tsx}'] })),
  {
    files: ['src/**/*.{ts,tsx}'],
    ...reactHooks.configs['recommended-latest'],
    ...reactRefresh.configs.vite,
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  // --- Node (server, scripts, root .js): node globals; relax no-unused-vars to warn ---
  {
    files: ['server/**/*.js', 'scripts/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: { 'no-unused-vars': 'warn' },
  },
])
