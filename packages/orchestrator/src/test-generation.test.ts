import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import { executeTestGenerationStep, type GeneratedTestValidator } from './test-generation.js';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './index.js';
import { loadWorkflowDirectory } from './workflows.js';

const command: NormalizedCommand = {
  intent: 'generate-test-suite',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: {}
};

class FakeGeneratedTestValidator implements GeneratedTestValidator {
  requests: Parameters<GeneratedTestValidator['validate']>[0][] = [];
  result: Awaited<ReturnType<GeneratedTestValidator['validate']>> = { status: 'passed' };
  async validate(request: Parameters<GeneratedTestValidator['validate']>[0]) {
    this.requests.push(request);
    return this.result;
  }
}

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
    expect(coverage).toMatch(/\| SCN-001\s+\| REQ-001\s+\| confirmed\s+\|/);
    expect(coverage).not.toContain('SCN-002');
  });

  it('inherits document-level automation approval for its scenarios', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/requirements.md'),
      '| REQ-001 | A seeded user can sign in. | confirmed |\n'
    );
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/sign-in.md'),
      [
        '# Approved scenarios',
        '',
        '- Status: approved for automation',
        '',
        '## SCN-001: Seeded user signs in',
        '',
        '- Traceability: REQ-001'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;

    await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'design-coverage')!,
      command
    );

    expect(readFileSync(join(projectRoot, 'derived/scenarios/coverage-map.md'), 'utf8')).toMatch(
      /\| SCN-001\s+\| REQ-001\s+\| confirmed\s+\|/
    );
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
            { kind: 'text', testId: 'balance', value: '$12,480.50' },
            { kind: 'roleText', role: 'alert', value: 'Signed in' }
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
      command,
      new FakeGeneratedTestValidator()
    );

    expect(result.status).toBe('succeeded');
    const generated = readFileSync(
      join(projectRoot, 'tests/generated/scn-001.generated.spec.ts'),
      'utf8'
    );
    expect(generated).toContain('// Approved scenario: SCN-001');
    expect(generated).toContain('// Requirements: REQ-001');
    expect(generated).not.toContain('testInfo');
    expect(generated).toContain("page.getByLabel('Email').fill('alex@example.test')");
    expect(generated).toContain("page.getByRole('heading', { name: 'Good morning, Alex Morgan' })");
    expect(generated).toContain(').toBeVisible()');
    expect(generated).toContain("page.getByRole('alert')).toHaveText('Signed in')");
  });

  it('generates Playwright tests from journeys when no approved scenarios exist', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/requirements.md'),
      '| ID | Statement | Status |\n| --- | --- | --- |\n| REQ-001 | Shopper can sign in | confirmed |\n'
    );
    writeFileSync(
      join(projectRoot, 'sources/reference/journeys.md'),
      [
        '## JRN-001: Sign in and view inventory',
        '',
        '- Requirement links: REQ-001',
        '',
        '```json qali-playwright',
        JSON.stringify({
          path: '/',
          actions: [
            { kind: 'fill', label: 'Username', value: 'standard_user' },
            { kind: 'click', role: 'button', name: 'Login' }
          ],
          assertions: [{ kind: 'visible', role: 'heading', name: 'Products' }]
        }),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;

    const coverage = await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'design-coverage')!,
      command
    );
    const generated = await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'generate-tests')!,
      command,
      new FakeGeneratedTestValidator()
    );

    expect(coverage.status).toBe('succeeded');
    expect(generated.status).toBe('succeeded');
    const spec = readFileSync(
      join(projectRoot, 'tests/generated/jrn-001.generated.spec.ts'),
      'utf8'
    );
    expect(spec).toContain('// Generated from: JRN-001');
    expect(spec).toContain('// Requirements: REQ-001');
    expect(spec).not.toContain('// Generation request:');
    expect(spec).toContain("page.getByRole('button', { name: 'Login' })");
    expect(existsSync(join(projectRoot, 'derived/scenarios/approved'))).toBe(false);
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
      { ...command, parameters: { visualTesting: true } },
      new FakeGeneratedTestValidator()
    );

    const generated = readFileSync(
      join(projectRoot, 'tests/generated/vis-001.generated.spec.ts'),
      'utf8'
    );
    expect(generated).toContain("await expect(page).toHaveScreenshot('dashboard.png')");
    expect(generated).toContain('// Evidence-only screenshot; not a visual assertion.');
    expect(generated).toContain("testInfo.outputPath('dashboard-run-evidence.png')");
  });

  it('runs deterministic validation and targeted execution for generated scenarios', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/generated.md'),
      [
        '## SCN-007: Generated behavior',
        '',
        '- Status: approved for automation',
        '- Traceability: REQ-007',
        '',
        '```json qali-playwright',
        JSON.stringify({ path: '/', actions: [], assertions: [] }),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;
    const validator = new FakeGeneratedTestValidator();

    const result = await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'generate-tests')!,
      command,
      validator
    );

    expect(result.status).toBe('succeeded');
    expect(validator.requests).toEqual([
      {
        workspace,
        projectId: 'sample',
        generatedPaths: ['projects/sample/tests/generated/scn-007.generated.spec.ts'],
        scenarioIds: ['SCN-007']
      }
    ]);

    validator.result = { status: 'failed', error: 'targeted Playwright execution failed' };
    const failed = await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'generate-tests')!,
      command,
      validator
    );
    expect(failed).toEqual({ status: 'failed', error: 'targeted Playwright execution failed' });
  });

  it('runs both generation steps through the production orchestrator in Mock Mode', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/requirements.md'),
      '| REQ-001 | Sign in | confirmed |\n'
    );
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/sign-in.md'),
      [
        '## SCN-001: Sign in',
        '- Status: approved for automation',
        '- Traceability: REQ-001',
        '```json qali-playwright',
        JSON.stringify({ path: '/', actions: [], assertions: [] }),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;
    const validator = new FakeGeneratedTestValidator();

    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (step) =>
          executeTestGenerationStep(
            workspace,
            step,
            command,
            step.id === 'generate-tests' ? validator : undefined
          )
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'a'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(readFileSync(join(projectRoot, 'derived/scenarios/coverage-map.md'), 'utf8')).toContain(
      'SCN-001'
    );
    expect(validator.requests).toHaveLength(1);
  });

  it.each([
    ['protocol-relative path', { path: '//evil.example', actions: [], assertions: [] }],
    ['parent path segment', { path: '/../admin', actions: [], assertions: [] }],
    [
      'unknown action',
      { path: '/', actions: [{ kind: 'evaluate', script: 'alert(1)' }], assertions: [] }
    ],
    [
      'malformed assertion',
      { path: '/', actions: [], assertions: [{ kind: 'text', testId: 'balance' }] }
    ],
    [
      'traversing screenshot name',
      { path: '/', actions: [], assertions: [{ kind: 'visual', name: '../escape.png' }] }
    ]
  ])('rejects a %s contract before validation', async (_label, contract) => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/invalid.md'),
      [
        '## SCN-INVALID: Invalid contract',
        '- Status: approved for automation',
        '- Traceability: REQ-001',
        '```json qali-playwright',
        JSON.stringify(contract),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;
    const validator = new FakeGeneratedTestValidator();

    await expect(
      executeTestGenerationStep(
        workspace,
        workflow.steps.find(({ id }) => id === 'generate-tests')!,
        command,
        validator
      )
    ).rejects.toThrow(/invalid qali-playwright scenario/i);
    expect(validator.requests).toHaveLength(0);
  });

  it('rejects generated scenarios without requirement traceability', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/untraced.md'),
      [
        '## SCN-UNTRACED: Missing requirement',
        '- Status: approved for automation',
        '```json qali-playwright',
        JSON.stringify({ path: '/', actions: [], assertions: [] }),
        '```'
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;

    await expect(
      executeTestGenerationStep(
        workspace,
        workflow.steps.find(({ id }) => id === 'generate-tests')!,
        command,
        new FakeGeneratedTestValidator()
      )
    ).rejects.toThrow(/SCN-UNTRACED.*requirement traceability/i);
  });

  it('removes stale generated specs before validating the current approved set', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'derived/scenarios/approved'), { recursive: true });
    mkdirSync(join(projectRoot, 'tests/generated'), { recursive: true });
    writeFileSync(join(projectRoot, 'tests/generated/stale.generated.spec.ts'), 'obsolete');
    writeFileSync(
      join(projectRoot, 'derived/scenarios/approved/current.md'),
      [
        '## SCN-CURRENT: Current scenario',
        '- Status: approved for automation',
        '- Traceability: REQ-001',
        '```json qali-playwright',
        JSON.stringify({ path: '/', actions: [], assertions: [] }),
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
      command,
      new FakeGeneratedTestValidator()
    );

    expect(existsSync(join(projectRoot, 'tests/generated/stale.generated.spec.ts'))).toBe(false);
    expect(existsSync(join(projectRoot, 'tests/generated/scn-current.generated.spec.ts'))).toBe(
      true
    );
  });

  it('stamps generated specs with the generation request id', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/requirements.md'),
      '| ID | Statement | Status |\n| --- | --- | --- |\n| REQ-001 | Shopper can sign in | confirmed |\n'
    );
    writeFileSync(
      join(projectRoot, 'sources/reference/journeys.md'),
      [
        '## JRN-001: Sign in and view inventory',
        '',
        '- Requirement links: REQ-001',
        '',
        '```json qali-playwright',
        JSON.stringify({
          path: '/',
          actions: [],
          assertions: [{ kind: 'visible', role: 'heading', name: 'Products' }]
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
      workflow.steps.find(({ id }) => id === 'design-coverage')!,
      command
    );
    await executeTestGenerationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'generate-tests')!,
      { ...command, parameters: { generationRequestId: 'Ev-generate-1' } },
      new FakeGeneratedTestValidator()
    );

    expect(
      readFileSync(join(projectRoot, 'tests/generated/jrn-001.generated.spec.ts'), 'utf8')
    ).toContain('// Generation request: Ev-generate-1');
  });

  it('retracts only generated specs from the correlated generation request', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-test-generation-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'tests/generated'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'tests/generated/jrn-001.generated.spec.ts'),
      ['test("old", () => {});', '// Generation request: Ev-old'].join('\n')
    );
    writeFileSync(
      join(projectRoot, 'tests/generated/jrn-002.generated.spec.ts'),
      ['test("newer", () => {});', '// Generation request: Ev-new'].join('\n')
    );
    writeFileSync(
      join(projectRoot, 'tests/generated/untagged.generated.spec.ts'),
      'test("legacy", () => {});'
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'generate-test-suite')!;
    const generateTests = workflow.steps.find(({ id }) => id === 'generate-tests')!;

    const result = await executeTestGenerationStep(
      workspace,
      generateTests,
      { ...command, parameters: { retractGeneratedTests: true, sourceRequestId: 'Ev-old' } },
      new FakeGeneratedTestValidator()
    );

    expect(result.status).toBe('succeeded');
    expect(existsSync(join(projectRoot, 'tests/generated/jrn-001.generated.spec.ts'))).toBe(false);
    expect(existsSync(join(projectRoot, 'tests/generated/jrn-002.generated.spec.ts'))).toBe(true);
    expect(existsSync(join(projectRoot, 'tests/generated/untagged.generated.spec.ts'))).toBe(true);

    const unscoped = await executeTestGenerationStep(
      workspace,
      generateTests,
      { ...command, parameters: { retractGeneratedTests: true } },
      new FakeGeneratedTestValidator()
    );
    expect(unscoped.status).toBe('succeeded');
    expect(existsSync(join(projectRoot, 'tests/generated/jrn-002.generated.spec.ts'))).toBe(true);
  });
});
