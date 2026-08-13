import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { executeSuiteMaintenanceStep } from './suite-maintenance.js';

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
      oracleFingerprintUnchanged: true,
      selectorNeutralFingerprintUnchanged: true
    });
  });
});
