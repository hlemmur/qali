import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import {
  executeTriageStep,
  fingerprintFailureReport,
  type TriageRegressionValidator
} from './triage.js';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './execution.js';
import { loadWorkflowDirectory } from './workflows.js';

const failureReport = (error: string, duration: number) => ({
  suites: [
    {
      title: 'tests/checkout.spec.ts',
      specs: [
        {
          title: 'CHK-001 checkout rejects an expired card',
          file: 'tests/checkout.spec.ts',
          tests: [
            {
              projectName: 'functional-chromium',
              status: 'unexpected',
              results: [
                {
                  status: 'failed',
                  duration,
                  errors: [{ message: error }]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
});

describe('failure triage', () => {
  it('creates a stable deterministic fingerprint from failure identity, not run noise', () => {
    const first = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-1',
      report: failureReport(
        '\u001b[31mExpected decline banner after 30000ms\u001b[39m\n    at /tmp/a/checkout.spec.ts:19:4',
        30_041
      )
    });
    const repeated = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-2',
      report: failureReport(
        'Expected decline banner after 29987ms\n    at /different/root/checkout.spec.ts:21:7',
        29_992
      )
    });
    const changed = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-3',
      report: failureReport('Expected receipt heading', 30_000)
    });

    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(first).toMatchObject({
      version: 1,
      sourceRunId: 'run-1',
      projectId: 'shop',
      failureCount: 1,
      failures: [
        {
          title: 'CHK-001 checkout rejects an expired card',
          projectName: 'functional-chromium',
          file: 'tests/checkout.spec.ts',
          error: 'Expected decline banner after <duration>'
        }
      ]
    });
  });

  it('materializes the source run fingerprint before any explanation step', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-triage-fingerprint-'));
    const command: NormalizedCommand = {
      intent: 'triage-failure',
      project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
      requestedBy: 'U1',
      externalRole: 'qa-lead-admin',
      receivedAt: '2026-08-13T00:00:00.000Z',
      parameters: { sourceRunId: 'run-1' }
    };
    const resultsPath = join(
      workspace,
      command.project.root,
      'observations/evidence/test-runs/results.json'
    );
    mkdirSync(dirname(resultsPath), { recursive: true });
    writeFileSync(resultsPath, JSON.stringify(failureReport('Expected decline banner', 40)));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'triage-and-reproduce')!;

    const result = await executeTriageStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'fingerprint')!,
      command
    );

    expect(result).toEqual({
      status: 'succeeded',
      outputs: [
        {
          artifact: 'evidence',
          path: 'projects/shop/observations/evidence/reproductions/fingerprint.json'
        }
      ]
    });
    const artifact = JSON.parse(
      readFileSync(
        join(workspace, 'projects/shop/observations/evidence/reproductions/fingerprint.json'),
        'utf8'
      )
    );
    expect(artifact).toMatchObject({ sourceRunId: 'run-1', failureCount: 1 });
  });

  it('builds Mock Mode explanation only from the materialized fingerprint', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-triage-explain-'));
    const command: NormalizedCommand = {
      intent: 'triage-failure',
      project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
      requestedBy: 'U1',
      externalRole: 'qa-lead-admin',
      receivedAt: '2026-08-13T00:00:00.000Z',
      parameters: { sourceRunId: 'run-1' }
    };
    const fingerprintPath = join(
      workspace,
      command.project.root,
      'observations/evidence/reproductions/fingerprint.json'
    );
    mkdirSync(dirname(fingerprintPath), { recursive: true });
    const fingerprint = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-1',
      report: failureReport('Expected decline banner', 40)
    });
    writeFileSync(fingerprintPath, JSON.stringify(fingerprint));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'triage-and-reproduce')!;

    const result = await executeTriageStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explain')!,
      command
    );

    expect(result.status).toBe('succeeded');
    const explanation = readFileSync(
      join(workspace, command.project.root, 'derived/reports/triage-explanation.md'),
      'utf8'
    );
    expect(explanation).toContain(fingerprint.fingerprint);
    expect(explanation).toContain('Source run: `run-1`');
    expect(explanation).toContain('Mock Mode');
  });

  it('creates a minimal regression candidate and requires observed red evidence', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-triage-reproduce-'));
    const command: NormalizedCommand = {
      intent: 'triage-failure',
      project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
      requestedBy: 'U1',
      externalRole: 'qa-lead-admin',
      receivedAt: '2026-08-13T00:00:00.000Z',
      parameters: { sourceRunId: 'run-1' }
    };
    const projectRoot = join(workspace, command.project.root);
    const fingerprint = fingerprintFailureReport({
      projectId: 'shop',
      sourceRunId: 'run-1',
      report: failureReport('Expected decline banner', 40)
    });
    const fingerprintPath = join(
      projectRoot,
      'observations/evidence/reproductions/fingerprint.json'
    );
    mkdirSync(dirname(fingerprintPath), { recursive: true });
    writeFileSync(fingerprintPath, JSON.stringify(fingerprint));
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, 'tests/checkout.spec.ts'), '// existing failing oracle\n');
    mkdirSync(join(projectRoot, 'derived/reports'), { recursive: true });
    writeFileSync(join(projectRoot, 'derived/reports/triage-explanation.md'), '# Explanation\n');
    const requests: Parameters<TriageRegressionValidator['observeRed']>[0][] = [];
    const validator: TriageRegressionValidator = {
      async observeRed(request) {
        requests.push(request);
        return {
          status: 'red',
          evidence: ['test-results/regression-trace.zip']
        };
      }
    };
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'triage-and-reproduce')!;

    const result = await executeTriageStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'reproduce')!,
      command,
      validator
    );

    expect(result.status).toBe('succeeded');
    expect(requests).toEqual([
      {
        workspace,
        projectId: 'shop',
        candidatePath: expect.stringMatching(
          /^projects\/shop\/tests\/regressions\/[a-f0-9]{12}\.spec\.ts$/
        ),
        title: 'CHK-001 checkout rejects an expired card',
        fingerprint: fingerprint.fingerprint
      }
    ]);
    const candidate = readFileSync(join(workspace, requests[0]!.candidatePath), 'utf8');
    expect(candidate).toContain("import '../checkout.spec.js'");
    expect(candidate).toContain(fingerprint.fingerprint);
    const reproduction = JSON.parse(
      readFileSync(
        join(projectRoot, 'observations/evidence/reproductions/reproduction.json'),
        'utf8'
      )
    );
    expect(reproduction).toMatchObject({
      fingerprint: fingerprint.fingerprint,
      observedStatus: 'red',
      evidence: ['test-results/regression-trace.zip']
    });
  });

  it('runs fingerprint, explanation, red reproduction, and reporting through the production orchestrator', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-triage-e2e-'));
    const command: NormalizedCommand = {
      intent: 'triage-failure',
      project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
      requestedBy: 'U1',
      externalRole: 'qa-lead-admin',
      receivedAt: '2026-08-13T00:00:00.000Z',
      parameters: { sourceRunId: 'run-1' }
    };
    const projectRoot = join(workspace, command.project.root);
    const resultsPath = join(projectRoot, 'observations/evidence/test-runs/results.json');
    mkdirSync(dirname(resultsPath), { recursive: true });
    writeFileSync(resultsPath, JSON.stringify(failureReport('Expected decline banner', 40)));
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, 'tests/checkout.spec.ts'), '// existing failing oracle\n');
    writeFileSync(join(projectRoot, 'observations/known-issues.md'), '# Known Issues\n');
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'triage-and-reproduce')!;
    const validator: TriageRegressionValidator = {
      async observeRed() {
        return { status: 'red', evidence: ['test-results/regression-trace.zip'] };
      }
    };

    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (step, executionCommand) =>
          executeTriageStep(workspace, step, executionCommand, validator)
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'd'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts.map(({ stepId }) => stepId)).toEqual([
      'fingerprint',
      'explain',
      'reproduce',
      'report'
    ]);
    const report = readFileSync(join(projectRoot, 'derived/reports/triage.md'), 'utf8');
    expect(report).toContain('Source run: `run-1`');
    expect(report).toContain('Observed regression state: **red**');
    expect(report).toContain('tests/regressions/');
    expect(report).toContain('test-results/regression-trace.zip');
  });
});
