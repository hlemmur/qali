import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ControlledPublisher,
  assessGeneratedChanges,
  assessSemanticPublication,
  createSemanticPublicationChange,
  type GitHubPublicationPort,
  type PublicationRequest
} from './index.js';
import type { SemanticPublicationManifest } from '../../contracts/src/index.js';

const semanticManifest = (
  changes: SemanticPublicationManifest['changes']
): SemanticPublicationManifest => ({
  version: 1,
  requestId: 'REQ-42',
  projectRoot: 'projects/shop',
  baseBranch: 'main',
  reviewOnly: true,
  title: 'Qali governed updates',
  commitMessage: 'Publish governed Qali updates',
  checks: [
    {
      command: 'npm',
      args: ['run', 'build'],
      exitCode: 0,
      durationMs: 100,
      stdout: 'ok',
      stderr: ''
    }
  ],
  changes
});

describe('semantic publication policy', () => {
  it('allows append-only observations and rejects replacement or raw browser evidence', () => {
    const appended = createSemanticPublicationChange({
      path: 'projects/shop/observations/exploration.md',
      before: '# Observations\n',
      after: '# Observations\n\n- Checkout failed (evidence: run-42).\n',
      provenanceRef: 'run:42'
    });
    expect(assessSemanticPublication(semanticManifest([appended]))).toEqual({ allowed: true });

    const replaced = createSemanticPublicationChange({
      path: 'projects/shop/observations/exploration.md',
      before: '# Observations\n\n- Existing fact.\n',
      after: '# Observations\n\n- Rewritten fact.\n',
      provenanceRef: 'run:42'
    });
    expect(assessSemanticPublication(semanticManifest([replaced]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/append-only/i)
    });

    const trace = createSemanticPublicationChange({
      path: 'projects/shop/observations/evidence/run-42/trace.zip',
      before: null,
      after: 'raw trace bytes',
      provenanceRef: 'run:42'
    });
    expect(assessSemanticPublication(semanticManifest([trace]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/outside git/i)
    });

    for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
      const misplacedScreenshot = createSemanticPublicationChange({
        path: `projects/shop/observations/run-42.${extension}`,
        before: null,
        after: 'raw screenshot bytes',
        provenanceRef: 'run:42'
      });
      expect(misplacedScreenshot.classification).toBe('raw-evidence');
      expect(assessSemanticPublication(semanticManifest([misplacedScreenshot]))).toMatchObject({
        allowed: false,
        reason: expect.stringMatching(/outside git/i)
      });
    }
  });

  it('rejects path traversal and platform-specific escape syntax', () => {
    for (const path of [
      'projects/shop/observations/../../.github/workflows/evil.yml',
      'projects/shop/observations\\..\\..\\evil.yml'
    ]) {
      const escaped = createSemanticPublicationChange({
        path,
        before: null,
        after: 'malicious workflow',
        provenanceRef: 'run:42'
      });
      expect(assessSemanticPublication(semanticManifest([escaped]))).toMatchObject({
        allowed: false,
        reason: expect.stringMatching(/unsafe path/i)
      });
    }
  });

  it('requires approved scenarios for new tests and unchanged oracles for modified tests', () => {
    const newTest = createSemanticPublicationChange({
      path: 'projects/shop/tests/checkout.spec.ts',
      before: null,
      after: "test('checkout', async ({ page }) => { await expect(page).toHaveURL('/done'); });\n"
    });
    expect(assessSemanticPublication(semanticManifest([newTest]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/approved scenario|generation source/i)
    });
    expect(
      assessSemanticPublication(
        semanticManifest([{ ...newTest, approvedScenarioRef: 'SCN-CHECKOUT-01' }])
      )
    ).toEqual({ allowed: true });
    expect(
      assessSemanticPublication(
        semanticManifest([
          { ...newTest, generationSourceRef: 'sources/reference/journeys.md#JRN-001' }
        ])
      )
    ).toEqual({ allowed: true });

    const selectorRepair = createSemanticPublicationChange({
      path: 'projects/shop/tests/checkout.spec.ts',
      before:
        "test('checkout', async ({ page }) => { await page.locator('#pay').click(); await expect(page.getByText('Paid')).toBeVisible(); });\n",
      after:
        "test('checkout', async ({ page }) => { await page.getByRole('button', { name: 'Pay' }).click(); await expect(page.getByText('Paid')).toBeVisible(); });\n"
    });
    expect(assessSemanticPublication(semanticManifest([selectorRepair]))).toEqual({
      allowed: true
    });

    const weakenedOracle = createSemanticPublicationChange({
      path: 'projects/shop/tests/checkout.spec.ts',
      before:
        "test('checkout', async ({ page }) => { await expect(page.getByText('Paid')).toBeVisible(); });\n",
      after:
        "test('checkout', async ({ page }) => { await expect(page.getByText('Pending')).toBeVisible(); });\n"
    });
    expect(assessSemanticPublication(semanticManifest([weakenedOracle]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/oracle/i)
    });
  });

  it('rejects visual baselines and non-spec artifacts under tests', () => {
    const baseline = createSemanticPublicationChange({
      path: 'projects/shop/tests/checkout.spec.ts-snapshots/checkout-chromium.png',
      before: 'old baseline bytes',
      after: 'new baseline bytes'
    });
    expect(assessSemanticPublication(semanticManifest([baseline]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/baseline|non-spec|raw browser evidence/i)
    });

    const snapshot = createSemanticPublicationChange({
      path: 'projects/shop/tests/__snapshots__/checkout.snap',
      before: 'old snapshot',
      after: 'new snapshot'
    });
    expect(assessSemanticPublication(semanticManifest([snapshot]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/non-spec/i)
    });
  });

  it('fingerprints soft and polling Playwright assertions', () => {
    for (const [before, after] of [
      [
        "test('soft', async ({ page }) => { await expect.soft(page.getByText('Paid')).toBeVisible(); });\n",
        "test('soft', async ({ page }) => { await expect.soft(page.getByText('Pending')).toBeVisible(); });\n"
      ],
      [
        "test('poll', async ({ page }) => { await expect.poll(() => page.title()).toBe('Paid'); });\n",
        "test('poll', async ({ page }) => { await expect.poll(() => page.title()).toBe('Pending'); });\n"
      ]
    ] as const) {
      const change = createSemanticPublicationChange({
        path: 'projects/shop/tests/checkout.spec.ts',
        before,
        after
      });
      expect(assessSemanticPublication(semanticManifest([change]))).toMatchObject({
        allowed: false,
        reason: expect.stringMatching(/oracle/i)
      });
    }
  });

  it('requires authority and provenance for governed-source changes', () => {
    const source = createSemanticPublicationChange({
      path: 'projects/shop/sources/reference/risks.md',
      before: '# Risks\n',
      after: '# Risks\n\n- RISK-2: Payment timeout.\n',
      provenanceRef: 'run:42'
    });
    expect(assessSemanticPublication(semanticManifest([source]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/authority and provenance/i)
    });
    expect(
      assessSemanticPublication(semanticManifest([{ ...source, authorityRef: 'decision:D-12' }]))
    ).toEqual({ allowed: true });

    const decision = createSemanticPublicationChange({
      path: 'projects/shop/sources/decisions.md',
      before: '# Decisions\n',
      after: '# Decisions\n\n- Auto-merge all changes.\n',
      provenanceRef: 'run:42',
      authorityRef: 'decision:D-12'
    });
    expect(assessSemanticPublication(semanticManifest([decision]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/reviewer-owned authority/i)
    });
  });

  it('publishes derived artifacts only when their generated-content hash is valid', () => {
    const body = '\n\n# Coverage\n\nAll approved scenarios are traced.\n';
    const generated = `<!-- qali:generated owner=qali sha256=${createHash('sha256').update(body).digest('hex')} -->${body}`;
    const report = createSemanticPublicationChange({
      path: 'projects/shop/derived/reports/coverage.md',
      before: null,
      after: generated
    });
    expect(assessSemanticPublication(semanticManifest([report]))).toEqual({ allowed: true });

    const tampered = createSemanticPublicationChange({
      path: report.path,
      before: null,
      after: `${generated}\nManually declared check: passed.\n`
    });
    expect(assessSemanticPublication(semanticManifest([tampered]))).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/generated hash/i)
    });
  });
});

const request = (
  changes: PublicationRequest['changes'],
  checks: PublicationRequest['checks'] = [{ name: 'npm run check', passed: true }]
): PublicationRequest => ({
  requestId: 'REQ-42',
  baseBranch: 'main',
  title: 'Qali generated updates',
  commitMessage: 'Publish governed Qali updates',
  checks,
  changes
});

describe('generated-change publication policy', () => {
  it('permits only provenance-preserving generated artifacts and approved tests', () => {
    expect(
      assessGeneratedChanges(
        request([
          {
            path: 'projects/shop/derived/reports/run.md',
            mutation: 'render-derived-report',
            content: 'generated'
          },
          {
            path: 'projects/shop/observations/exploration.md',
            mutation: 'append-observation',
            provenanceRef: 'session:2026-08-11',
            content: 'observed'
          },
          {
            path: 'projects/shop/tests/generated/login.spec.ts',
            mutation: 'create-test',
            approvedScenarioRef: 'derived/scenarios/approved/login.md',
            content: 'test'
          },
          {
            path: 'projects/shop/tests/generated/login.spec.ts',
            mutation: 'repair-test-equivalent',
            approvedScenarioRef: 'derived/scenarios/approved/login.md',
            content: 'repaired test'
          }
        ])
      )
    ).toEqual({ allowed: true });
  });

  it.each([
    ['projects/shop/sources/decisions.md', 'change-expected-behavior'],
    ['projects/shop/tests/login.spec.ts-snapshots/home.png', 'update-visual-baseline'],
    ['projects/shop/tests/login.spec.ts', 'weaken-assertion'],
    ['projects/shop/tests/login.spec.ts', 'skip-test'],
    ['projects/shop/tests/login.spec.ts', 'delete-test']
  ] as const)('rejects unsafe change %s (%s)', (path, mutation) => {
    expect(assessGeneratedChanges(request([{ path, mutation, content: 'unsafe' }]))).toMatchObject({
      allowed: false
    });
  });

  it('rejects deletion flags, source changes without authority, and failed checks', () => {
    expect(
      assessGeneratedChanges(
        request([
          {
            path: 'projects/shop/derived/reports/old.md',
            mutation: 'render-derived-report',
            deleted: true
          }
        ])
      )
    ).toMatchObject({ allowed: false });
    expect(
      assessGeneratedChanges(
        request([
          {
            path: 'projects/shop/sources/reference/risks.md',
            mutation: 'update-governed-source',
            provenanceRef: 'report:77',
            content: 'risk'
          }
        ])
      )
    ).toMatchObject({ allowed: false });
    expect(
      assessGeneratedChanges(request([], [{ name: 'npm run check', passed: false }]))
    ).toMatchObject({ allowed: false });
  });

  it('allows governed source observations only with authority and provenance metadata', () => {
    expect(
      assessGeneratedChanges(
        request([
          {
            path: 'projects/shop/sources/reference/risks.md',
            mutation: 'update-governed-source',
            authorityRef: 'D-12',
            provenanceRef: 'report:77',
            content: 'risk'
          }
        ])
      )
    ).toEqual({ allowed: true });
  });
});

describe('controlled GitHub publisher', () => {
  it('creates a review-only Qali branch, commit, and evidence-backed PR after checks pass', async () => {
    const calls: string[] = [];
    let pullRequestBody = '';
    const github: GitHubPublicationPort = {
      createBranch: async (branch) => void calls.push(`branch:${branch}`),
      commit: async (branch, _message, changes) =>
        void calls.push(`commit:${branch}:${changes.length}`),
      createPullRequest: async ({ body }) => {
        pullRequestBody = body;
        calls.push('pr');
        return { number: 17, nodeId: 'PR_node', url: 'https://github.test/pr/17' };
      }
    };
    const publisher = new ControlledPublisher(github);

    const result = await publisher.publish(
      semanticManifest([
        createSemanticPublicationChange({
          path: 'projects/shop/observations/exploration.md',
          before: null,
          after: '# Observation\n',
          provenanceRef: 'run:42'
        })
      ])
    );

    expect(result).toEqual({
      status: 'published',
      branch: 'qali/req-42',
      pullRequestUrl: 'https://github.test/pr/17'
    });
    expect(calls).toEqual(['branch:qali/req-42', 'commit:qali/req-42:1', 'pr']);
    expect(pullRequestBody).toContain('`npm run build`');
    expect(pullRequestBody).toContain('exit 0');
    expect(pullRequestBody).toContain('Review-only publication');
  });

  it('does not call GitHub when publication policy rejects a request', async () => {
    const github: GitHubPublicationPort = {
      createBranch: async () => {
        throw new Error('must not run');
      },
      commit: async () => {
        throw new Error('must not run');
      },
      createPullRequest: async () => {
        throw new Error('must not run');
      }
    };

    await expect(
      new ControlledPublisher(github).publish(
        semanticManifest([
          createSemanticPublicationChange({
            path: 'projects/shop/derived/reports/report.md',
            before: null,
            after: 'manual report'
          })
        ])
      )
    ).resolves.toMatchObject({ status: 'rejected' });
  });
});
