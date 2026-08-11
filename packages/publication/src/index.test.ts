import { describe, expect, it } from 'vitest';
import {
  ControlledPublisher,
  assessGeneratedChanges,
  type GitHubPublicationPort,
  type PublicationRequest
} from './index.js';

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
  it('creates a Qali branch, commit, PR, and auto-merge only after policy checks pass', async () => {
    const calls: string[] = [];
    const github: GitHubPublicationPort = {
      createBranch: async (branch) => void calls.push(`branch:${branch}`),
      commit: async (branch, _message, changes) =>
        void calls.push(`commit:${branch}:${changes.length}`),
      createPullRequest: async () => {
        calls.push('pr');
        return { number: 17, nodeId: 'PR_node', url: 'https://github.test/pr/17' };
      },
      enableAutoMerge: async (nodeId) => void calls.push(`merge:${nodeId}`)
    };
    const publisher = new ControlledPublisher(github);

    const result = await publisher.publish(
      request([
        {
          path: 'projects/shop/derived/reports/run.md',
          mutation: 'render-derived-report',
          content: 'generated'
        }
      ])
    );

    expect(result).toEqual({
      status: 'published',
      branch: 'qali/req-42',
      pullRequestUrl: 'https://github.test/pr/17'
    });
    expect(calls).toEqual(['branch:qali/req-42', 'commit:qali/req-42:1', 'pr', 'merge:PR_node']);
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
      },
      enableAutoMerge: async () => {
        throw new Error('must not run');
      }
    };

    await expect(
      new ControlledPublisher(github).publish(
        request([
          {
            path: 'src/app.ts',
            mutation: 'modify-source-code',
            content: 'source'
          }
        ])
      )
    ).resolves.toMatchObject({ status: 'rejected' });
  });
});
