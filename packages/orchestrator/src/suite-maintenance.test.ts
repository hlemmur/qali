import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './execution.js';
import { executeSuiteMaintenanceStep } from './suite-maintenance.js';
import { loadWorkflowDirectory } from './workflows.js';

const command: NormalizedCommand = {
  intent: 'maintain-suite',
  project: { id: 'shop', root: 'projects/shop', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: {}
};

const repairCommand: NormalizedCommand = {
  ...command,
  parameters: {
    selectorRepair: {
      testPath: 'tests/checkout.spec.ts',
      locatorMethod: 'locator',
      from: '#submit',
      to: '[data-testid="submit-order"]'
    }
  }
};

const step = (id: string, outputs: WorkflowStep['outputs']): WorkflowStep =>
  ({ id, outputs }) as WorkflowStep;

function writeRun(workspace: string, runId: string): void {
  const directory = join(
    workspace,
    command.project.root,
    'observations/evidence/test-runs/history'
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${runId}.json`),
    `${JSON.stringify({
      suites: [
        {
          specs: [
            {
              file: 'shop/tests/checkout.spec.ts',
              title: 'checkout submits an order',
              tests: [
                {
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      errors: [{ message: "locator('#submit') timed out waiting for element" }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })}\n`
  );
}

describe('suite maintenance', () => {
  it('diagnoses selector drift only after repeated evidence-backed failures', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-suite-diagnosis-'));
    writeRun(workspace, 'run-1');
    writeRun(workspace, 'run-2');

    const result = await executeSuiteMaintenanceStep(
      workspace,
      step('diagnose', [
        {
          artifact: 'reports',
          path: 'projects/{projectId}/derived/reports/reliability-diagnosis.json'
        },
        {
          artifact: 'reports',
          path: 'projects/{projectId}/derived/reports/reliability-diagnosis.md'
        }
      ]),
      command
    );

    expect(result.status).toBe('succeeded');
    const diagnosis = JSON.parse(
      readFileSync(
        join(workspace, command.project.root, 'derived/reports/reliability-diagnosis.json'),
        'utf8'
      )
    );
    expect(diagnosis.findings).toEqual([
      expect.objectContaining({
        testPath: 'projects/shop/tests/checkout.spec.ts',
        title: 'checkout submits an order',
        classification: 'selector-drift',
        failedRuns: 2,
        evidence: [
          'observations/evidence/test-runs/history/run-1.json',
          'observations/evidence/test-runs/history/run-2.json'
        ]
      })
    ]);
    expect(
      readFileSync(
        join(workspace, command.project.root, 'derived/reports/reliability-diagnosis.md'),
        'utf8'
      )
    ).toContain('Repeated selector drift');
  });

  it('applies an equivalent selector repair with an unchanged oracle fingerprint', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-suite-repair-'));
    const testPath = join(workspace, command.project.root, 'tests/checkout.spec.ts');
    mkdirSync(join(workspace, command.project.root, 'tests'), { recursive: true });
    writeFileSync(
      testPath,
      [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('checkout submits an order', async ({ page }) => {",
        "  await page.locator('#submit').click();",
        "  await expect(page.getByText('Receipt')).toBeVisible();",
        '});',
        ''
      ].join('\n')
    );
    writeRun(workspace, 'run-1');
    writeRun(workspace, 'run-2');

    await executeSuiteMaintenanceStep(
      workspace,
      step('snapshot', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/suite-maintenance/baseline.json'
        }
      ]),
      repairCommand
    );
    await executeSuiteMaintenanceStep(
      workspace,
      step('diagnose', [
        {
          artifact: 'reports',
          path: 'projects/{projectId}/derived/reports/reliability-diagnosis.json'
        }
      ]),
      repairCommand
    );
    const repair = await executeSuiteMaintenanceStep(
      workspace,
      step('repair-selectors', [{ artifact: 'tests', path: 'projects/{projectId}/tests' }]),
      repairCommand
    );
    const validation = await executeSuiteMaintenanceStep(
      workspace,
      step('validate-repair', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/suite-maintenance/validation.json'
        }
      ]),
      repairCommand
    );

    expect(repair.status).toBe('succeeded');
    expect(validation.status).toBe('succeeded');
    expect(readFileSync(testPath, 'utf8')).toContain(
      'page.locator(\'[data-testid="submit-order"]\')'
    );
    const evidence = JSON.parse(
      readFileSync(
        join(
          workspace,
          command.project.root,
          'observations/evidence/suite-maintenance/validation.json'
        ),
        'utf8'
      )
    );
    expect(evidence).toMatchObject({
      status: 'accepted',
      changedFiles: ['projects/shop/tests/checkout.spec.ts'],
      repeatedFailureEvidenceBacked: true,
      oracleFingerprintUnchanged: true,
      selectorNeutralFingerprintUnchanged: true
    });
  });

  it('rejects a fingerprint-equivalent repair without repeated failure evidence', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-suite-unproven-repair-'));
    const projectRoot = join(workspace, command.project.root);
    const testPath = join(projectRoot, 'tests/checkout.spec.ts');
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(
      testPath,
      [
        "import { expect, test } from '@playwright/test';",
        "test('checkout submits an order', async ({ page }) => {",
        "  await page.locator('#submit').click();",
        "  await expect(page.getByText('Receipt')).toBeVisible();",
        '});',
        ''
      ].join('\n')
    );
    await executeSuiteMaintenanceStep(
      workspace,
      step('snapshot', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/suite-maintenance/baseline.json'
        }
      ]),
      repairCommand
    );
    writeFileSync(
      testPath,
      readFileSync(testPath, 'utf8').replace(
        "locator('#submit')",
        'locator(\'[data-testid="submit-order"]\')'
      )
    );

    const validation = await executeSuiteMaintenanceStep(
      workspace,
      step('validate-repair', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/suite-maintenance/validation.json'
        }
      ]),
      repairCommand
    );

    expect(validation).toEqual({
      status: 'failed',
      error: 'suite repair is not backed by repeated failures'
    });
    expect(
      JSON.parse(
        readFileSync(
          join(projectRoot, 'observations/evidence/suite-maintenance/validation.json'),
          'utf8'
        )
      )
    ).toMatchObject({ status: 'rejected', repeatedFailureEvidenceBacked: false });
  });

  it('runs guarded suite maintenance through the production orchestrator in Mock Mode', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-suite-e2e-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    mkdirSync(join(projectRoot, 'sources'), { recursive: true });
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/project-context.md'), '# Context\n');
    writeFileSync(join(projectRoot, 'sources/decisions.md'), '# Decisions\n');
    writeFileSync(join(projectRoot, 'derived/scenarios/approved/checkout.md'), '# Checkout\n');
    writeFileSync(
      join(projectRoot, 'tests/checkout.spec.ts'),
      [
        "import { expect, test } from '@playwright/test';",
        "test('checkout submits an order', async ({ page }) => {",
        "  await page.locator('#submit').click();",
        "  await expect(page.getByText('Receipt')).toBeVisible();",
        '});',
        ''
      ].join('\n')
    );
    writeRun(workspace, 'run-1');
    writeRun(workspace, 'run-2');
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'suite-maintenance')!;

    const result = await executeWorkflow(repairCommand, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (workflowStep, workflowCommand) =>
          executeSuiteMaintenanceStep(workspace, workflowStep, workflowCommand)
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'f'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts.map(({ stepId }) => stepId)).toEqual([
      'snapshot',
      'diagnose',
      'repair-selectors',
      'validate-repair'
    ]);
    expect(
      JSON.parse(
        readFileSync(
          join(projectRoot, 'observations/evidence/suite-maintenance/validation.json'),
          'utf8'
        )
      )
    ).toMatchObject({ status: 'accepted', oracleFingerprintUnchanged: true });
  });

  it('rejects a repair that changes more selectors than the approved replacement', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-suite-extra-selector-'));
    const projectRoot = join(workspace, command.project.root);
    const testPath = join(projectRoot, 'tests/checkout.spec.ts');
    mkdirSync(join(projectRoot, 'tests'), { recursive: true });
    writeFileSync(
      testPath,
      [
        "import { expect, test } from '@playwright/test';",
        "test('checkout submits an order', async ({ page }) => {",
        "  await page.getByText('Cart').click();",
        "  await page.locator('#submit').click();",
        "  await expect(page.getByText('Receipt')).toBeVisible();",
        '});',
        ''
      ].join('\n')
    );
    writeRun(workspace, 'run-1');
    writeRun(workspace, 'run-2');
    await executeSuiteMaintenanceStep(
      workspace,
      step('snapshot', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/suite-maintenance/baseline.json'
        }
      ]),
      repairCommand
    );
    await executeSuiteMaintenanceStep(
      workspace,
      step('diagnose', [
        {
          artifact: 'reports',
          path: 'projects/{projectId}/derived/reports/reliability-diagnosis.json'
        }
      ]),
      repairCommand
    );
    await executeSuiteMaintenanceStep(
      workspace,
      step('repair-selectors', [{ artifact: 'tests', path: 'projects/{projectId}/tests' }]),
      repairCommand
    );
    writeFileSync(
      testPath,
      readFileSync(testPath, 'utf8').replace("getByText('Cart')", "getByText('Basket')")
    );

    const validation = await executeSuiteMaintenanceStep(
      workspace,
      step('validate-repair', [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/suite-maintenance/validation.json'
        }
      ]),
      repairCommand
    );

    expect(validation).toEqual({
      status: 'failed',
      error: 'suite repair changed behavior outside one selector'
    });
  });
});
