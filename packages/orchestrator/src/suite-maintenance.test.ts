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
});
