import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './execution.js';
import { executeQualityPulseStep } from './quality-pulse.js';
import { loadWorkflowDirectory } from './workflows.js';

const command: NormalizedCommand = {
  intent: 'quality-pulse',
  project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T10:00:00.000Z',
  parameters: {}
};

const aggregateStep = {
  id: 'aggregate',
  outputs: [
    {
      artifact: 'evidence',
      path: 'projects/{projectId}/observations/evidence/quality-pulse/facts.json'
    }
  ]
} as WorkflowStep;

function write(workspace: string, path: string, contents: string): void {
  const target = join(workspace, command.project.root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

describe('quality pulse', () => {
  it('aggregates runs, risks, failures, coverage, and open decisions from deterministic evidence', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-quality-pulse-'));
    write(
      workspace,
      'observations/evidence/test-runs/run-1.json',
      JSON.stringify({
        suites: [
          {
            specs: [
              {
                tests: [
                  { status: 'expected', results: [{ status: 'passed', duration: 100 }] },
                  {
                    status: 'unexpected',
                    results: [{ status: 'failed', duration: 50, error: { message: 'boom' } }]
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    write(
      workspace,
      'sources/reference/risks.md',
      '# Risks\n\n## RISK-001: Payment failure\n\n- Status: open\n\n## RISK-002: Search latency\n\n- Status: mitigated\n'
    );
    write(
      workspace,
      'derived/scenarios/approved/checkout.md',
      '# Scenarios\n\n## SHOP-001: Checkout\n\n## SHOP-002: Decline\n'
    );
    write(workspace, 'tests/checkout.spec.ts', "test('SHOP-001 checkout', async () => {});\n");
    write(
      workspace,
      'sources/questions.md',
      '# Questions\n\n| ID | Question | Status |\n| --- | --- | --- |\n| Q-001 | Which card? | open |\n| Q-002 | Currency? | answered |\n'
    );
    write(
      workspace,
      'sources/decisions.md',
      '# Decisions\n\n| ID | Decision | Status |\n| --- | --- | --- |\n| D-001 | Retry policy | proposed |\n| D-002 | Use EUR | confirmed |\n'
    );

    const result = await executeQualityPulseStep(workspace, aggregateStep, command);

    expect(result.status).toBe('succeeded');
    const facts = JSON.parse(
      readFileSync(
        join(workspace, command.project.root, 'observations/evidence/quality-pulse/facts.json'),
        'utf8'
      )
    );
    expect(facts).toMatchObject({
      version: 1,
      projectId: 'shop',
      generatedAt: command.receivedAt,
      runs: { count: 1, total: 2, passed: 1, failed: 1, skipped: 0, durationMs: 150 },
      risks: { total: 2, open: 1 },
      failures: { count: 1 },
      coverage: { approvedScenarios: 2, automatedScenarios: 1, percent: 50 },
      openDecisions: { questions: 1, proposedDecisions: 1, total: 2 }
    });
    expect(facts.sources).toEqual([
      'derived/scenarios/approved/checkout.md',
      'observations/evidence/test-runs/run-1.json',
      'sources/decisions.md',
      'sources/questions.md',
      'sources/reference/risks.md',
      'tests/checkout.spec.ts'
    ]);
  });

  it('keeps presentation text separate while the host renders immutable facts', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-quality-presentation-'));
    write(
      workspace,
      'observations/evidence/quality-pulse/facts.json',
      `${JSON.stringify({
        version: 1,
        projectId: 'shop',
        generatedAt: command.receivedAt,
        factsHash: 'a'.repeat(64),
        runs: { count: 2, total: 8, passed: 7, failed: 1, skipped: 0, durationMs: 4200 },
        risks: { total: 3, open: 2 },
        failures: { count: 1 },
        coverage: { approvedScenarios: 5, automatedScenarios: 4, percent: 80 },
        openDecisions: { questions: 1, proposedDecisions: 1, total: 2 },
        sources: ['observations/evidence/test-runs/run-1.json']
      })}\n`
    );

    await executeQualityPulseStep(
      workspace,
      {
        id: 'present',
        outputs: [
          {
            artifact: 'reports',
            path: 'projects/{projectId}/derived/reports/quality-pulse-presentation.json'
          }
        ]
      } as WorkflowStep,
      command
    );
    const result = await executeQualityPulseStep(
      workspace,
      {
        id: 'render',
        outputs: [
          {
            artifact: 'reports',
            path: 'projects/{projectId}/derived/reports/quality-pulse.md'
          }
        ]
      } as WorkflowStep,
      command
    );

    expect(result.status).toBe('succeeded');
    const report = readFileSync(
      join(workspace, command.project.root, 'derived/reports/quality-pulse.md'),
      'utf8'
    );
    expect(report).toContain('## Run health');
    expect(report).toContain('- Tests: 8 total, 7 passed, 1 failed, 0 skipped');
    expect(report).toContain('- Coverage: 4/5 approved scenarios automated (80%)');
    expect(report).toContain('- Open decisions: 2 (1 questions, 1 proposed decisions)');
    expect(report).toContain('observations/evidence/test-runs/run-1.json');
  });

  it('uses one production-orchestrator workflow for command and scheduled Mock Mode pulses', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-quality-e2e-'));
    write(workspace, 'sources/project-context.md', '# Shop\n');
    write(workspace, 'sources/questions.md', '# Questions\n');
    write(workspace, 'sources/decisions.md', '# Decisions\n');
    write(workspace, 'observations/known-issues.md', '# Known issues\n');
    write(workspace, 'observations/evidence/test-runs/run.json', JSON.stringify({ suites: [] }));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'quality-pulse')!;

    expect(workflow.triggers).toContainEqual({ type: 'command', intent: 'quality-pulse' });
    expect(workflow.triggers).toContainEqual({ type: 'schedule', cron: '17 6 * * *' });
    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (workflowStep, workflowCommand) =>
          executeQualityPulseStep(workspace, workflowStep, workflowCommand)
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'f'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts.map(({ stepId }) => stepId)).toEqual(['aggregate', 'present', 'render']);
    expect(
      readFileSync(
        join(workspace, command.project.root, 'derived/reports/quality-pulse.md'),
        'utf8'
      )
    ).toContain('- Tests: 0 total, 0 passed, 0 failed, 0 skipped');
  });
});
