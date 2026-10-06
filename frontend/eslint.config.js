import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results', 'blob-report']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.node },
  },
  {
    files: ['*.config.{ts,js}', 'e2e/**', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Context modules export a hook next to a provider on purpose, and tests export helpers.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*Context.tsx', 'src/components/ui/Toast.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
