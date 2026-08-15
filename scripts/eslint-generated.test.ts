import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('generated Playwright lint policy', () => {
  it('accepts Playwright empty fixture patterns under tests/generated', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const results = await eslint.lintText(
      `import { test as base } from '@playwright/test';

export const test = base.extend({
  lockedOutUser: async ({}, use) => {
    await use({ username: 'locked_out_user' });
  }
});
`,
      {
        filePath: join(
          repositoryRoot,
          'projects/sauce-demo/tests/generated/e2e/fixtures/login.fixture.ts'
        )
      }
    );
    const errors = results.flatMap((result) =>
      result.messages.filter((message) => message.severity === 2)
    );
    expect(errors).toEqual([]);
  });

  it('accepts inline import() type annotations under tests/generated', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const results = await eslint.lintText(
      `type LoginPage = import('../pages/login.page').LoginPage;
export type GeneratedLoginPage = LoginPage;
`,
      {
        filePath: join(
          repositoryRoot,
          'projects/sauce-demo/tests/generated/e2e/tests/auth/login.validation.spec.ts'
        )
      }
    );
    const errors = results.flatMap((result) =>
      result.messages.filter((message) => message.severity === 2)
    );
    expect(errors).toEqual([]);
  });
});
