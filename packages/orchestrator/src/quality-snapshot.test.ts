import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { buildQualitySnapshot, executeQueryProjectStep } from './quality-snapshot.js';

const command: NormalizedCommand = {
  intent: 'query-project',
  project: { id: 'shop', root: 'projects/shop' },
  requestedBy: 'U1',
  externalRole: 'developer',
  receivedAt: '2026-08-13T12:00:00.000Z',
  parameters: { topic: 'status' }
};

const snapshotStep = {
  id: 'snapshot',
  outputs: [
    { artifact: 'reports', path: 'projects/{projectId}/derived/reports/quality-snapshot.json' }
  ]
} as WorkflowStep;

function write(workspace: string, path: string, contents: string): void {
  const target = join(workspace, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

describe('query-project snapshot', () => {
  it('reads pack files and last run counts without requiring a browser', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-query-'));
    write(
      workspace,
      'projects/shop/derived/reports/test-run.json',
      JSON.stringify({
        status: 'passed',
        intent: 'run-test-suite',
        total: 2,
        passed: 2,
        failed: 0,
        skipped: 0
      })
    );
    write(workspace, 'projects/shop/derived/scenarios/approved/login.md', '# login\n');
    write(workspace, 'projects/shop/tests/login.spec.ts', 'test("login", () => {});\n');
    write(workspace, 'projects/shop/sources/reference/journeys.md', '## JRN-001: Login\n');
    write(workspace, 'projects/shop/sources/questions.md', '# Questions\n');
    write(
      workspace,
      'projects/registry.json',
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: 'shop',
            schedules: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }]
          }
        ]
      })
    );

    const result = await executeQueryProjectStep(workspace, snapshotStep, command);
    const snapshot = buildQualitySnapshot(workspace, command, new Date('2026-08-13T12:00:00.000Z'));

    expect(result.status).toBe('succeeded');
    expect(snapshot.lastRun?.counts).toEqual({ total: 2, passed: 2, failed: 0, skipped: 0 });
    expect(snapshot.coverage).toEqual({ approvedScenarios: 1, automatedTests: 1, percent: 100 });
    expect(snapshot.journeys).toContain('JRN-001: Login');
    expect(snapshot.schedules).toEqual([
      { workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }
    ]);
    expect(
      JSON.parse(readFileSync(join(workspace, '.qali/quality-snapshot.json'), 'utf8')).projectId
    ).toBe('shop');
  });
});
