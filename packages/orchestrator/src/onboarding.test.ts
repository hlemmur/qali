import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeOnboardingMockStep,
  executeWorkflow,
  loadWorkflowDirectory,
  prepareOnboardProject,
  summarizeOnboardingReport,
  upsertOnboardedProjectRegistry
} from './index.js';

const command: NormalizedCommand = {
  intent: 'onboard-project',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: {}
};

describe('deterministic project onboarding', () => {
  it('builds governed context from evidence and leaves missing facts unknown', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboarding-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/onboarding-evidence.json'),
      JSON.stringify({
        version: 1,
        projectName: 'Sample Portal',
        observedAt: '2026-08-13',
        facts: [
          {
            id: 'FACT-001',
            category: 'product',
            statement: 'Sample Portal lets customers review open support requests.',
            source: 'README.md'
          },
          {
            id: 'FACT-002',
            category: 'quality-goal',
            statement: 'Customers must always see the current request status.',
            source: 'requirements.md#status'
          }
        ],
        journeys: [],
        risks: []
      })
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'project-onboarding')!;

    const result = await executeOnboardingMockStep(workspace, workflow.steps[0]!, command);

    expect(result.status).toBe('succeeded');
    const context = readFileSync(join(projectRoot, 'sources/project-context.md'), 'utf8');
    const questions = readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8');
    expect(context).toContain('Sample Portal lets customers review open support requests.');
    expect(context).toContain('Source: `README.md`');
    expect(context).toContain('## Tech Stack\n\nUnknown');
    expect(context).not.toMatch(/Node|React|Playwright/);
    expect(questions).toContain('What is the project tech stack?');
    expect(questions).toContain('| open |');
    expect(summarizeOnboardingReport(projectRoot)).toMatchObject({
      findings: expect.arrayContaining([expect.stringMatching(/Q-00\d .+tech stack/i)]),
      evidence: expect.arrayContaining(['sources/project-context.md', 'sources/questions.md'])
    });
  });

  it('derives journeys, risks, strategy, and plan with evidence traceability', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboarding-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/onboarding-evidence.json'),
      JSON.stringify({
        version: 1,
        projectName: 'Sample Portal',
        observedAt: '2026-08-13',
        facts: [
          {
            id: 'FACT-001',
            category: 'product',
            statement: 'Customers review support requests.',
            source: 'README.md'
          }
        ],
        journeys: [
          {
            id: 'JRN-001',
            actor: 'customer',
            goal: 'review an open request',
            steps: ['sign in', 'open support requests', 'select a request'],
            outcome: 'the current request status is visible',
            requirementIds: ['REQ-001'],
            source: 'requirements.md#REQ-001'
          }
        ],
        risks: [
          {
            id: 'RSK-001',
            statement: 'A stale status can cause a customer to take the wrong action.',
            impact: 5,
            probability: 3,
            source: 'REQ-001'
          }
        ]
      })
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'project-onboarding')!;

    for (const step of workflow.steps) {
      await expect(executeOnboardingMockStep(workspace, step, command)).resolves.toMatchObject({
        status: 'succeeded'
      });
    }

    const journeys = readFileSync(join(projectRoot, 'sources/reference/journeys.md'), 'utf8');
    const risks = readFileSync(join(projectRoot, 'derived/reports/risk-assessment.md'), 'utf8');
    const scenario = readFileSync(join(projectRoot, 'derived/scenarios/smoke-proposal.md'), 'utf8');
    const plan = readFileSync(join(projectRoot, 'derived/reports/initial-test-plan.md'), 'utf8');
    const strategy = readFileSync(join(projectRoot, 'derived/strategy.md'), 'utf8');
    const canonicalPlan = readFileSync(join(projectRoot, 'derived/plan.md'), 'utf8');
    expect(journeys).toContain('Source: `requirements.md#REQ-001`');
    expect(risks).toContain('| RSK-001 |');
    expect(risks).toContain('| 15 |');
    expect(scenario).toContain('JRN-001');
    expect(scenario).toContain('REQ-001');
    expect(plan).toContain('## Strategy');
    expect(plan).toContain('Prioritize `RSK-001`');
    expect(plan).toContain('## Initial Plan');
    expect(plan).not.toContain('TBD');
    expect(existsSync(join(projectRoot, 'sources/reference/risks.md'))).toBe(false);
    expect(strategy).toContain('Prioritize `RSK-001`');
    expect(canonicalPlan).toContain('Validate `JRN-001`');
    expect(readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8')).toContain(
      'Exploration Charter'
    );
    expect(existsSync(join(projectRoot, 'derived/workflow-state/schedule.yaml'))).toBe(true);
  });

  it('runs onboarding end to end through the production orchestrator in Mock Mode', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboarding-e2e-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/onboarding-evidence.json'),
      JSON.stringify({
        version: 1,
        projectName: 'Sample Portal',
        observedAt: '2026-08-13',
        facts: [
          {
            id: 'FACT-001',
            category: 'product',
            statement: 'Customers review support requests.',
            source: 'README.md'
          }
        ],
        journeys: [
          {
            id: 'JRN-001',
            actor: 'customer',
            goal: 'review an open request',
            steps: ['sign in', 'open support requests'],
            outcome: 'the request status is visible',
            requirementIds: ['REQ-001'],
            source: 'requirements.md#REQ-001'
          }
        ],
        risks: [
          {
            id: 'RSK-001',
            statement: 'A stale status can mislead a customer.',
            impact: 5,
            probability: 3,
            source: 'REQ-001'
          }
        ]
      })
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'project-onboarding')!;
    const events = new FakeEventStore();

    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (step, executionCommand) =>
          executeOnboardingMockStep(workspace, step, executionCommand)
      },
      events,
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'a'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts).toHaveLength(7);
    expect(events.events.map(({ type }) => type)).toEqual([
      'workflow-started',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'step-started',
      'step-succeeded',
      'workflow-succeeded'
    ]);
    expect(readFileSync(join(projectRoot, 'sources/project-context.md'), 'utf8')).not.toContain(
      'Deterministic fallback'
    );
    expect(readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8')).toContain(
      'Exploration Charter'
    );
    expect(
      readFileSync(join(projectRoot, 'derived/workflow-state/schedule.yaml'), 'utf8')
    ).toContain('quality-pulse');
  });

  it('scaffolds a new pack from the template and writes URL evidence without touching the registry', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboard-scaffold-'));
    mkdirSync(join(workspace, 'projects'), { recursive: true });
    writeFileSync(
      join(workspace, 'projects/registry.json'),
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: 'sauce-demo',
            root: 'projects/sauce-demo',
            githubEnvironment: 'qali-sauce-demo',
            allowedSlack: {
              teamIds: [],
              channelIds: ['C1'],
              userIds: ['U1'],
              roles: ['developer', 'qa-lead-admin']
            },
            publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
            enabledWorkflows: [
              'onboard-project',
              'explore-project',
              'generate-test-suite',
              'run-test-suite',
              'triage-failure',
              'maintain-knowledge',
              'maintain-suite',
              'maintain-schedule',
              'quality-pulse',
              'query-project'
            ],
            schedules: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }],
            activeExecutionProfile: 'sauce-demo-production'
          }
        ]
      })
    );
    const onboardCommand: NormalizedCommand = {
      ...command,
      project: {
        id: 'example-com',
        root: 'projects/example-com',
        environment: 'qali-example-com',
        environmentLabel: 'production',
        executionProfileId: 'example-com-production'
      },
      parameters: { targetUrl: 'https://example.com/', origin: 'https://example.com' }
    };

    prepareOnboardProject(workspace, onboardCommand, {
      templateRoot: join(process.cwd(), 'projects/_template')
    });

    const projectRoot = join(workspace, 'projects/example-com');
    expect(existsSync(join(projectRoot, 'execution-profile.json'))).toBe(true);
    const profile = JSON.parse(readFileSync(join(projectRoot, 'execution-profile.json'), 'utf8'));
    expect(profile).toMatchObject({
      id: 'example-com-production',
      projectId: 'example-com',
      environmentLabel: 'production'
    });
    const evidence = JSON.parse(
      readFileSync(join(projectRoot, 'sources/reference/onboarding-evidence.json'), 'utf8')
    );
    expect(evidence.facts[0]).toMatchObject({
      category: 'environment',
      source: 'https://example.com/'
    });
    expect(evidence.facts[0].statement).toContain('https://example.com');
    const registry = JSON.parse(readFileSync(join(workspace, 'projects/registry.json'), 'utf8'));
    expect(registry.projects.map((project: { id: string }) => project.id)).toEqual([
      'sauce-demo',
      'example-com'
    ]);
    expect(registry.projects[1]).toMatchObject({
      id: 'example-com',
      root: 'projects/example-com',
      githubEnvironment: 'qali-example-com',
      activeExecutionProfile: 'example-com-production'
    });
    expect(JSON.stringify(evidence)).not.toMatch(/password|secret_sauce/i);
  });

  it('copies Slack scope from the channel-matched donor, not the first registry row', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboard-donor-'));
    mkdirSync(join(workspace, 'projects'), { recursive: true });
    const donorA = {
      id: 'alpha',
      root: 'projects/alpha',
      githubEnvironment: 'qali-alpha',
      allowedSlack: {
        teamIds: [],
        channelIds: ['C_A'],
        userIds: ['U1'],
        roles: ['developer', 'qa-lead-admin']
      },
      publication: { owner: 'hlemmur', repo: 'qali', branch: 'main', reviewOnly: true },
      enabledWorkflows: ['onboard-project'],
      schedules: [{ workflowId: 'quality-pulse', cron: '17 6 * * *', enabled: true }],
      activeExecutionProfile: 'alpha-production'
    };
    const donorB = {
      ...donorA,
      id: 'beta',
      root: 'projects/beta',
      githubEnvironment: 'qali-beta',
      allowedSlack: { ...donorA.allowedSlack, channelIds: ['C_B'] },
      activeExecutionProfile: 'beta-production'
    };
    writeFileSync(
      join(workspace, 'projects/registry.json'),
      JSON.stringify({ version: 1, projects: [donorA, donorB] })
    );
    const onboardCommand: NormalizedCommand = {
      ...command,
      project: {
        id: 'example-com',
        root: 'projects/example-com',
        environment: 'qali-example-com',
        environmentLabel: 'production',
        executionProfileId: 'example-com-production'
      },
      slack: { teamId: 'T1', channelId: 'C_B', threadTs: '1.1', requestTs: '1.1' },
      parameters: { targetUrl: 'https://example.com/', origin: 'https://example.com' }
    };

    upsertOnboardedProjectRegistry(workspace, onboardCommand);

    const registry = JSON.parse(readFileSync(join(workspace, 'projects/registry.json'), 'utf8'));
    expect(registry.projects.at(-1)).toMatchObject({
      id: 'example-com',
      allowedSlack: { channelIds: ['C_B'] }
    });
  });

  it('reuses an existing pack and only fills missing URL evidence', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboard-reuse-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'execution-profile.json'),
      JSON.stringify({ id: 'sample-production', projectId: 'sample' })
    );
    const onboardCommand: NormalizedCommand = {
      ...command,
      parameters: { targetUrl: 'https://www.saucedemo.com/', origin: 'https://www.saucedemo.com' }
    };

    prepareOnboardProject(workspace, onboardCommand);

    expect(JSON.parse(readFileSync(join(projectRoot, 'execution-profile.json'), 'utf8')).id).toBe(
      'sample-production'
    );
    const evidence = JSON.parse(
      readFileSync(join(projectRoot, 'sources/reference/onboarding-evidence.json'), 'utf8')
    );
    expect(evidence.facts[0].source).toBe('https://www.saucedemo.com/');
  });

  it('keeps an existing schedule and records a live first-explore session when a browser is present', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-onboard-explore-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    mkdirSync(join(projectRoot, 'derived/workflow-state'), { recursive: true });
    mkdirSync(join(projectRoot, 'observations'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'sources/reference/onboarding-evidence.json'),
      JSON.stringify({
        version: 1,
        projectName: 'Sample Portal',
        observedAt: '2026-08-13',
        facts: [],
        journeys: [],
        risks: []
      })
    );
    writeFileSync(
      join(projectRoot, 'derived/workflow-state/schedule.yaml'),
      [
        '# qali:generated owner=qali sha256=keep',
        'version: 1',
        'template: startup-e2e',
        'paused: false',
        'jobs:',
        '  - workflowId: quality-pulse',
        "    cron: '17 6 * * *'",
        '    enabled: true',
        ''
      ].join('\n')
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'project-onboarding')!;
    const browser = {
      calls: [] as string[],
      async navigate(path: string) {
        this.calls.push(`navigate:${path}`);
        return { url: 'https://www.saucedemo.com/' };
      },
      async accessibilitySnapshot() {
        this.calls.push('snapshot');
        return { untrustedPageData: '- heading "Swag Labs"' };
      },
      async captureEvidence(id: string) {
        this.calls.push(`evidence:${id}`);
        return { evidenceId: id, artifacts: [`${id}/screenshot.png`] };
      },
      async readDiagnostics() {
        return { untrustedConsole: [], untrustedNetwork: [] };
      }
    };

    for (const step of workflow.steps) {
      await expect(
        executeOnboardingMockStep(workspace, step, command, browser)
      ).resolves.toMatchObject({ status: 'succeeded' });
    }

    expect(browser.calls[0]).toBe('navigate:/');
    expect(readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8')).toContain(
      'www.saucedemo.com'
    );
    expect(
      readFileSync(join(projectRoot, 'derived/workflow-state/schedule.yaml'), 'utf8')
    ).toContain('startup-e2e');
    expect(readFileSync(join(projectRoot, 'derived/reports/exploration.md'), 'utf8')).toContain(
      'Exploration'
    );
  });
});
