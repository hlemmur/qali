import { describe, expect, it } from 'vitest';
import { ROLE_PROFILES, loadWorkflowDirectory, routeCommand, validateWorkflow } from './index.js';

const workflowDirectory = new URL('../../../workflows/', import.meta.url);
const skillCatalog = new URL('../../../skills/catalog.json', import.meta.url);

describe('workflow catalog', () => {
  it('loads and validates all eight workflow descriptors', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, skillCatalog);

    expect(workflows.map(({ id }) => id).sort()).toEqual(
      [
        'exploratory-testing',
        'generate-test-suite',
        'knowledge-maintenance',
        'project-onboarding',
        'quality-pulse',
        'run-test-suite',
        'suite-maintenance',
        'triage-and-reproduce'
      ].sort()
    );
  });

  it('keeps workflow artifacts in the canonical physical layout', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, skillCatalog);
    const expectedRoot = {
      'project-context': 'sources',
      reference: 'sources',
      exploration: 'observations',
      questions: 'sources',
      decisions: 'sources',
      'known-issues': 'observations',
      evidence: 'observations',
      scenarios: 'derived',
      reports: 'derived',
      tasks: 'derived',
      jobs: 'derived',
      'workflow-state': 'derived',
      tests: 'tests'
    } as const;

    for (const workflow of workflows) {
      for (const step of workflow.steps) {
        for (const reference of [...step.inputs, ...step.outputs]) {
          expect(reference.path, `${workflow.id}/${step.id}/${reference.artifact}`).toMatch(
            new RegExp(`^projects/\\{projectId\\}/${expectedRoot[reference.artifact]}(?:/|$)`)
          );
        }
      }
    }
  });

  it('keeps observed exploration knowledge in its single observation owner', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, skillCatalog);
    const exploration = workflows.find(({ id }) => id === 'exploratory-testing')!;
    const outputs = exploration.steps.flatMap((step) => step.outputs);

    expect(outputs).toContainEqual({
      artifact: 'exploration',
      path: 'projects/{projectId}/observations/exploration.md'
    });
    expect(outputs).not.toContainEqual(
      expect.objectContaining({ path: 'projects/{projectId}/sources/reference/exploration.md' })
    );
  });

  it('rejects unknown role and skill references', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, skillCatalog);
    const valid = workflows[0]!;

    expect(() =>
      validateWorkflow(
        {
          ...valid,
          steps: [{ ...valid.steps[0]!, role: 'missing-role' }]
        },
        { skillIds: new Set(['exploratory-testing']) }
      )
    ).toThrow(/role/i);

    expect(() =>
      validateWorkflow(
        {
          ...valid,
          steps: [{ ...valid.steps[0]!, skill: 'missing-skill' }]
        },
        { skillIds: new Set() }
      )
    ).toThrow(/skill/i);
  });

  it('prevents workflow steps from exceeding role permissions', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, skillCatalog);
    const run = workflows.find(({ id }) => id === 'run-test-suite')!;
    const execute = run.steps.find(({ role }) => role === 'executor')!;

    expect(ROLE_PROFILES.executor.permissions.writableArtifacts).not.toContain('decisions');
    expect(() =>
      validateWorkflow(
        {
          ...run,
          steps: [
            {
              ...execute,
              outputs: [
                {
                  artifact: 'decisions',
                  path: 'projects/{projectId}/sources/decisions.md'
                }
              ]
            }
          ]
        },
        {
          skillIds: new Set(['playwright-automation', 'ai-bug-triage', 'qa-report-humanizer'])
        }
      )
    ).toThrow(/permission/i);
  });
});

describe('deterministic intent routing', () => {
  it.each([
    ['onboard-project', 'project-onboarding'],
    ['explore-project', 'exploratory-testing'],
    ['generate-test-suite', 'generate-test-suite'],
    ['run-test-suite', 'run-test-suite'],
    ['triage-failure', 'triage-and-reproduce'],
    ['maintain-knowledge', 'knowledge-maintenance'],
    ['maintain-suite', 'suite-maintenance'],
    ['quality-pulse', 'quality-pulse']
  ] as const)('routes %s to %s', (intent, workflowId) => {
    const workflows = loadWorkflowDirectory(workflowDirectory, skillCatalog);
    const routed = routeCommand(
      {
        intent,
        project: { id: 'checkout', root: 'projects/checkout' },
        requestedBy: 'U123',
        receivedAt: '2026-08-10T20:00:00.000Z',
        parameters: {}
      },
      workflows
    );

    expect(routed.id).toBe(workflowId);
  });
});
