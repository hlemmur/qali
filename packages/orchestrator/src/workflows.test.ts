import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROLE_PROFILES, loadWorkflowDirectory, routeCommand, validateWorkflow } from './index.js';

const workflowDirectory = new URL('../../../workflows/', import.meta.url);
const harnessProfileCatalog = new URL('../../../harness/profiles.json', import.meta.url);

function validationContext() {
  const catalog = JSON.parse(readFileSync(harnessProfileCatalog, 'utf8')) as {
    profiles: Array<{
      id: string;
      kind?: 'agent' | 'host';
      tools: string[];
      mutations: string[];
    }>;
  };
  return {
    harnessProfiles: new Map(catalog.profiles.map((profile) => [profile.id, profile]))
  };
}

describe('workflow catalog', () => {
  it('keeps source-of-truth reference writes outside the test architect role', () => {
    expect(ROLE_PROFILES['test-architect'].permissions.writableArtifacts).not.toContain(
      'reference'
    );
  });

  it('loads and validates all eight workflow descriptors', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);

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
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
    const expectedRoot = {
      'project-context': 'sources',
      reference: 'sources',
      exploration: 'observations',
      strategy: 'derived',
      plan: 'derived',
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
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
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

  it('binds every agent and host step to the exact reviewed harness profile', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
    const bindings = Object.fromEntries(
      workflows.flatMap((workflow) =>
        workflow.steps.map((step) => [`${workflow.id}/${step.id}`, step.harnessProfileId])
      )
    );

    expect(bindings).toEqual({
      'project-onboarding/discover-project': 'onboarding-discovery',
      'project-onboarding/discover-journeys': 'journey-discovery',
      'project-onboarding/assess-risks': 'risk-assessment',
      'project-onboarding/plan-strategy': 'strategy-initial-plan',
      'exploratory-testing/charter': 'exploration-charter',
      'exploratory-testing/explore': 'browser-exploration',
      'exploratory-testing/report': 'human-reporting',
      'generate-test-suite/design-coverage': 'coverage-design',
      'generate-test-suite/generate-tests': 'test-generation',
      'knowledge-maintenance/curate': 'knowledge-reconciliation',
      'quality-pulse/report': 'human-reporting',
      'run-test-suite/execute': 'host-test-execution',
      'run-test-suite/analyze-failures': 'failure-explanation',
      'run-test-suite/report': 'human-reporting',
      'suite-maintenance/diagnose': 'reliability-diagnosis',
      'suite-maintenance/repair-selectors': 'selector-repair',
      'triage-and-reproduce/fingerprint': 'host-failure-fingerprinting',
      'triage-and-reproduce/explain': 'failure-explanation',
      'triage-and-reproduce/reproduce': 'reproduction',
      'triage-and-reproduce/report': 'human-reporting'
    });
  });

  it('rejects unknown role and harness profile references', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
    const valid = workflows[0]!;

    expect(() =>
      validateWorkflow(
        {
          ...valid,
          steps: [{ ...valid.steps[0]!, role: 'missing-role' }]
        },
        validationContext()
      )
    ).toThrow(/role/i);

    expect(() =>
      validateWorkflow(
        {
          ...valid,
          steps: [{ ...valid.steps[0]!, harnessProfileId: 'missing-profile' }]
        },
        validationContext()
      )
    ).toThrow(/harness profile/i);
  });

  it('prevents workflow steps from exceeding role permissions', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
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
        validationContext()
      )
    ).toThrow(/permission/i);
  });

  it('prevents agent steps from exceeding their harness profile permissions', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
    const exploration = workflows.find(({ id }) => id === 'exploratory-testing')!;
    const charter = exploration.steps.find(({ id }) => id === 'charter')!;
    const catalog = JSON.parse(readFileSync(harnessProfileCatalog, 'utf8')) as {
      profiles: Array<{
        id: string;
        kind?: 'agent' | 'host';
        tools: string[];
        mutations: string[];
      }>;
    };

    expect(() =>
      validateWorkflow(
        {
          ...exploration,
          steps: [{ ...charter, requiredTools: [...charter.requiredTools, 'browser'] }]
        },
        {
          harnessProfiles: new Map(catalog.profiles.map((profile) => [profile.id, profile]))
        } as unknown as Parameters<typeof validateWorkflow>[1]
      )
    ).toThrow(/harness profile permission/i);

    const context = {
      harnessProfiles: new Map(catalog.profiles.map((profile) => [profile.id, profile]))
    } as unknown as Parameters<typeof validateWorkflow>[1];
    expect(() =>
      validateWorkflow(
        {
          ...exploration,
          steps: [{ ...charter, mutations: [...charter.mutations, 'append-evidence'] }]
        },
        context
      )
    ).toThrow(/harness profile permission/i);

    const browser = exploration.steps.find(({ id }) => id === 'explore')!;
    expect(() =>
      validateWorkflow(
        {
          ...exploration,
          steps: [charter, { ...browser, requiredTools: ['file-read', 'file-write'] }]
        },
        context
      )
    ).toThrow(/harness profile permission/i);
  });

  it('requires harness definitions and enforces the host execution contract', () => {
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
    const run = workflows.find(({ id }) => id === 'run-test-suite')!;
    const execute = run.steps.find(({ id }) => id === 'execute')!;

    expect(() =>
      validateWorkflow(run, {} as unknown as Parameters<typeof validateWorkflow>[1])
    ).toThrow(/harness profile definitions/i);

    expect(() =>
      validateWorkflow(
        { ...run, steps: [{ ...execute, id: 'agent-execute' }] },
        validationContext()
      )
    ).toThrow(/host execution contract/i);

    expect(() =>
      validateWorkflow(
        {
          ...run,
          steps: [
            {
              ...execute,
              role: 'failure-analyst',
              outputs: execute.outputs.filter(({ artifact }) => artifact === 'evidence'),
              mutations: ['append-evidence']
            }
          ]
        },
        validationContext()
      )
    ).toThrow(/host execution contract/i);
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
    const workflows = loadWorkflowDirectory(workflowDirectory, harnessProfileCatalog);
    const routed = routeCommand(
      {
        intent,
        project: { id: 'checkout', root: 'projects/checkout' },
        requestedBy: 'U123',
        externalRole: 'developer',
        receivedAt: '2026-08-10T20:00:00.000Z',
        parameters: {}
      },
      workflows
    );

    expect(routed.id).toBe(workflowId);
  });
});
