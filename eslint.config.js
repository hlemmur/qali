import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'coverage',
      'dist',
      'playwright-report',
      'test-results',
      // Live Cursor Agent may drop ad-hoc probe scripts under evidence/.
      'projects/**/observations/evidence/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: ['projects/**/tests/generated/**/*.ts'],
    rules: {
      // Playwright fixtures commonly use `async ({}, use)` when they do not
      // consume other fixtures. Live generation must still pass repo lint.
      'no-empty-pattern': 'off'
    }
  }
);
