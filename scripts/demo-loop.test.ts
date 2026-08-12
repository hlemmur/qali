import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedCommand, WorkflowStep } from '../packages/contracts/src/index.js';
import type { PlaywrightRunner, PlaywrightRunRequest } from '../packages/playwright/src/index.js';
import { DemoPolicy, runDemoLoop } from './demo-loop.js';

class MaterializingPlaywrightRunner implements PlaywrightRunner {
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
                    results: [{ status: 'passed', duration: 25, attachments: [] }]
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    return { status: 'passed' as const, exitCode: 0 };
  }
}

describe('complete demo loop', () => {
  it('does not let autonomous mode bypass semantic approval gates', async () => {
    const command = {
      intent: 'run-test-suite',
      project: { id: '_demo', root: 'projects/_demo' },
      requestedBy: 'U-MOCK',
      externalRole: 'developer',
      receivedAt: '2026-08-10T20:00:00.000Z',
      parameters: {},
      autonomy: {
        mode: 'autonomous',
        approvalRefs: [],
        allowProceedWithOpenQuestions: false
      }
    } satisfies NormalizedCommand;
    const step = {
      id: 'protected-step',
      role: 'suite-maintainer',
      harnessProfileId: 'reliability-diagnosis',
      needs: [],
      inputs: [],
      outputs: [],
      requiredTools: [],
      mutations: ['delete-test'],
      policyGates: ['human-approval'],
      retries: 0,
      timeoutMs: 1000
    } satisfies WorkflowStep;

    await expect(new DemoPolicy().authorize(step, command)).resolves.toMatchObject({
      allowed: false
    });
  });

  it('routes a free-form request and materializes executable workflow outputs', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-demo-loop-'));
    const projectRoot = join(workspace, 'projects/_demo');
    mkdirSync(join(workspace, 'projects'), { recursive: true });
    cpSync(resolve('projects/_demo'), projectRoot, { recursive: true });
    const playwright = new MaterializingPlaywrightRunner();

    const result = await runDemoLoop({
      workspace,
      repositoryRoot: resolve('.'),
      playwright,
      now: () => new Date('2026-08-10T20:00:00.000Z')
    });

    expect(
      result.sequence.map(({ request, command, workflow }) => ({
        request,
        intent: command.intent,
        autonomy: command.autonomy?.mode,
        workflow: workflow.workflowId,
        status: workflow.status
      }))
    ).toEqual([
      {
        request: 'Explore login and dashboard',
        intent: 'explore-project',
        autonomy: 'autonomous',
        workflow: 'exploratory-testing',
        status: 'succeeded'
      },
      {
        request: 'Generate important dashboard tests',
        intent: 'generate-test-suite',
        autonomy: 'autonomous',
        workflow: 'generate-test-suite',
        status: 'succeeded'
      },
      {
        request: 'Run the dashboard suite',
        intent: 'run-test-suite',
        autonomy: 'autonomous',
        workflow: 'run-test-suite',
        status: 'succeeded'
      }
    ]);
    expect(playwright.requests).toHaveLength(1);
    expect(result.report).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(result.projectValidation).toEqual({ valid: true, issues: [] });
    expect(result.slack.text).toContain('1 passed');
    expect(JSON.stringify(result.slack.blocks)).not.toContain('Duration:');
    expect(JSON.stringify(result.slackDetails.blocks)).toContain('Duration: 25 ms');
    for (const path of Object.values(result.paths)) {
      if (Array.isArray(path)) {
        for (const item of path) expect(existsSync(item), item).toBe(true);
      } else {
        expect(existsSync(path), path).toBe(true);
      }
    }
    expect(result.paths.events).toHaveLength(3);
    expect(
      result.paths.events.every((path) =>
        readFileSync(path, 'utf8').includes('"workflow-succeeded"')
      )
    ).toBe(true);
    expect(readFileSync(result.paths.explorationLog, 'utf8')).toContain(
      'observations/evidence/exploration/login-dashboard.json'
    );
    expect(existsSync(join(projectRoot, 'sources/reference/exploration.md'))).toBe(false);
    expect(readFileSync(result.paths.generatedTest, 'utf8')).toContain('DEMO-GEN-001');
    expect(readFileSync(result.paths.markdownReport, 'utf8')).toContain('qali:generated');
  });
});
