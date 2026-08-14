import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import type { PlaywrightRunRequest, PlaywrightRunner } from '../../playwright/src/index.js';
import { describe, expect, it } from 'vitest';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './index.js';
import { executeTestRunStep } from './test-execution.js';
import { loadWorkflowDirectory } from './workflows.js';

const command: NormalizedCommand = {
  intent: 'run-test-suite',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: { requestId: 'run-10', suite: 'SMK-001.*' }
};

class ReportingPlaywrightRunner implements PlaywrightRunner {
  readonly requests: PlaywrightRunRequest[] = [];

  async run(request: PlaywrightRunRequest) {
    this.requests.push(request);
    mkdirSync(dirname(request.reportPath), { recursive: true });
    writeFileSync(
      request.reportPath,
      JSON.stringify({
        suites: [
          {
            specs: [
              {
                tests: [
                  {
                    status: 'expected',
                    results: [
                      {
                        status: 'passed',
                        duration: 42,
                        attachments: [{ path: 'test-results/trace.zip' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    return { status: 'passed' as const, exitCode: 0, stderr: 'runner warning' };
  }
}

describe('deterministic test execution', () => {
  it('runs the requested project suite and records accurate Playwright evidence', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-run-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'run-test-suite')!;
    const runner = new ReportingPlaywrightRunner();

    const outcome = await executeTestRunStep({
      workspace,
      step: workflow.steps.find(({ id }) => id === 'execute')!,
      command,
      runner,
      targetBaseUrl: 'http://127.0.0.1:4173',
      signal: new AbortController().signal
    });

    expect(runner.requests).toEqual([
      expect.objectContaining({
        workspace,
        projectId: 'sample',
        targetBaseUrl: 'http://127.0.0.1:4173',
        grep: 'SMK-001\\.\\*'
      })
    ]);
    expect(outcome.summary).toMatchObject({
      status: 'passed',
      total: 1,
      passed: 1,
      failed: 0,
      durationMs: 42,
      errors: []
    });
    expect(outcome.summary?.evidence).toEqual([
      expect.stringMatching(/observations\/evidence\/test-runs\/results\.json$/),
      'test-results/trace.zip'
    ]);
    expect(outcome.result.status).toBe('succeeded');
    expect(
      readFileSync(join(workspace, command.project.root, 'derived/jobs/test-run.md'), 'utf8')
    ).toContain('Status: passed');
  });

  it('does not reuse a stale JSON report when the current run cannot write one', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-run-stale-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'run-test-suite')!;
    const reportPath = join(
      workspace,
      command.project.root,
      'observations/evidence/test-runs/results.json'
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({
        suites: [{ specs: [{ tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }]
      })
    );
    const runner: PlaywrightRunner = {
      async run(request) {
        expect(existsSync(request.reportPath)).toBe(false);
        return { status: 'failed', exitCode: 1, stderr: 'browser failed before reporting' };
      }
    };

    const outcome = await executeTestRunStep({
      workspace,
      step: workflow.steps.find(({ id }) => id === 'execute')!,
      command,
      runner,
      targetBaseUrl: 'http://127.0.0.1:4173',
      signal: new AbortController().signal
    });

    expect(outcome.summary).toBeUndefined();
    expect(outcome.result).toEqual({
      status: 'failed',
      error: 'browser failed before reporting'
    });
    expect(existsSync(reportPath)).toBe(false);
  });

  it('uses the Playwright config JSON report when the named evidence file is missing', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-run-default-json-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'run-test-suite')!;
    mkdirSync(join(workspace, 'test-results'), { recursive: true });
    writeFileSync(
      join(workspace, 'test-results/results.json'),
      JSON.stringify({
        suites: [{ specs: [{ tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }] }]
      })
    );
    const runner: PlaywrightRunner = {
      async run() {
        return { status: 'passed', exitCode: 0 };
      }
    };

    const outcome = await executeTestRunStep({
      workspace,
      step: workflow.steps.find(({ id }) => id === 'execute')!,
      command,
      runner,
      targetBaseUrl: 'http://127.0.0.1:4173',
      signal: new AbortController().signal
    });

    expect(outcome.result.status).toBe('succeeded');
    expect(outcome.summary).toMatchObject({ status: 'passed', passed: 1, failed: 0 });
  });

  it('runs the test workflow through the production orchestrator in Mock Mode', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-run-e2e-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(join(projectRoot, 'tests/smoke.spec.ts'), '// deterministic fixture\n');
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'run-test-suite')!;
    const runner = new ReportingPlaywrightRunner();

    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: async (step, executionCommand, context) => {
          if (step.id === 'execute') {
            return (
              await executeTestRunStep({
                workspace,
                step,
                command: executionCommand,
                runner,
                targetBaseUrl: 'http://127.0.0.1:4173',
                signal: context.signal
              })
            ).result;
          }
          const outputs = step.outputs.map(({ artifact, path }) => ({
            artifact,
            path: path.replaceAll('{projectId}', executionCommand.project.id)
          }));
          for (const output of outputs) {
            const absolute = join(workspace, output.path);
            mkdirSync(dirname(absolute), { recursive: true });
            writeFileSync(absolute, `# ${step.id}\n`);
          }
          return { status: 'succeeded', outputs };
        }
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'c'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts.map(({ stepId }) => stepId)).toEqual(['execute', 'report']);
    expect(runner.requests).toHaveLength(1);
  });
});
