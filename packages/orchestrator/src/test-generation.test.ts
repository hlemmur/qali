import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { executeTestGenerationStep } from './test-generation.js';
import { loadWorkflowDirectory } from './workflows.js';

const command: NormalizedCommand = {
  intent: 'generate-test-suite',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: {}
};

describe('deterministic test generation', () => {
  it('builds coverage only from approved scenarios with requirement traceability', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/requirements.md'),
      [
        '# Requirements',
        '',
        '| ID | Requirement | Status |',
        '| --- | --- | --- |',
        '| REQ-001 | A seeded user can sign in. | confirmed |',
        '| REQ-002 | Unknown behavior. | unknown |'
      ].join('\n')
    );
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/sign-in.md'),
      [
        '# Approved scenarios',
        '',
        '## SCN-001: Seeded user signs in',
        '',
        '- Status: approved for automation',
        '- Traceability: REQ-001',
        '- Then the dashboard is visible',
        '',
        '## SCN-002: Unapproved draft',
        '',
        '- Status: proposed',
        '- Traceability: REQ-002'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;

    const result = await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'design-coverage')!,
      command
    );

    expect(result.status).toBe('succeeded');
    const coverage = readFileSync(join(projectRoot, 'derived/scenarios/coverage-map.md'), 'utf8');
    expect(coverage).toContain('| SCN-001 | REQ-001 | confirmed |');
    expect(coverage).not.toContain('SCN-002');
  });

  it('generates traceable Playwright code from an approved declarative scenario', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/sign-in.md'),
      [
        '# Approved scenarios',
        '',
        '## SCN-001: Seeded user signs in',
        '',
        '- Status: approved for automation',
        '- Traceability: REQ-001',
        '',
        '```json qali-playwright',
        JSON.stringify({
          path: '/',
          actions: [
            { kind: 'fill', label: 'Email', value: 'alex@example.test' },
            { kind: 'fill', label: 'Password', value: 'demo123' },
            { kind: 'click', role: 'button', name: 'Sign in' }
          ],
          assertions: [
            { kind: 'visible', role: 'heading', name: 'Good morning, Alex Morgan' },
            { kind: 'text', testId: 'balance', value: '$12,480.50' }
          ]
        }),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;

    const result = await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'generate-tests')!,
      command
    );

    expect(result.status).toBe('succeeded');
    const generated = readFileSync(
      join(projectRoot, 'tests/generated/scn-001.generated.spec.ts'),
      'utf8'
    );
    expect(generated).toContain('// Approved scenario: SCN-001');
    expect(generated).toContain('// Requirements: REQ-001');
    expect(generated).toContain("page.getByLabel('Email').fill('alex@example.test')");
    expect(generated).toContain(
      "expect(page.getByRole('heading', { name: 'Good morning, Alex Morgan' })).toBeVisible()"
    );
  });

  it('uses visual assertions for baselines and labels evidence-only screenshots separately', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/visual.md'),
      [
        '## VIS-001: Approved dashboard baseline',
        '',
        '- Status: approved for automation',
        '- Traceability: REQ-003',
        '',
        '```json qali-playwright',
        JSON.stringify({
          path: '/dashboard',
          actions: [],
          assertions: [
            { kind: 'visual', name: 'dashboard.png' },
            { kind: 'evidenceScreenshot', name: 'dashboard-run-evidence.png' }
          ]
        }),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;

    await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'generate-tests')!,
      { ...command, parameters: { visualTesting: true } }
    );

    const generated = readFileSync(
      join(projectRoot, 'tests/generated/vis-001.generated.spec.ts'),
      'utf8'
    );
    expect(generated).toContain("await expect(page).toHaveScreenshot('dashboard.png')");
    expect(generated).toContain('// Evidence-only screenshot; not a visual assertion.');
    expect(generated).toContain("testInfo.outputPath('dashboard-run-evidence.png')");
  });
});
