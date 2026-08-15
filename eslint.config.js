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
      // Live Cursor generation uses Playwright fixture empty patterns and
      // inline `import()` types that repo TypeScript ESLint otherwise forbids.
      'no-empty-pattern': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
