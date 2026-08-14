import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedCommand } from '../../contracts/src/index.js';
import { RestrictedBrowserFacade, type BrowserDriver } from '../../browser-facade/src/index.js';
import { describe, expect, it } from 'vitest';
import {
  executeExplorationStep,
  explorationBudget,
  type ExplorationBrowser
} from './exploration.js';
import {
  FakeEventStore,
  FakePolicyEnforcer,
  FakePreconditionChecker,
  FileSystemOutputValidator,
  executeWorkflow
} from './index.js';
import { loadWorkflowDirectory } from './workflows.js';

const command: NormalizedCommand = {
  intent: 'explore-project',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'mock' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: { area: 'login', maxSteps: '4', timeBudgetMs: '5000' }
};

class FakeBrowser implements ExplorationBrowser {
  readonly calls: string[] = [];
  async navigate(path: string) {
    this.calls.push(`navigate:${path}`);
    return { url: 'http://example.test/' };
  }
  async accessibilitySnapshot() {
    this.calls.push('snapshot');
    return { untrustedPageData: '- heading "Sign in"\n- textbox "Email"' };
  }
  async readDiagnostics() {
    this.calls.push('diagnostics');
    return { untrustedConsole: [], untrustedNetwork: [] };
  }
  async captureEvidence(id: string) {
    this.calls.push(`evidence:${id}`);
    return { evidenceId: id, artifacts: [`${id}/screenshot.png`] };
  }
}

class FakeBrowserDriver implements BrowserDriver {
  async navigate() {
    return { url: 'http://example.test/' };
  }
  async snapshot() {
    return '- heading "Sign in"\n- textbox "Email"';
  }
  async clickByRole() {
    return { url: 'http://example.test/' };
  }
  async fillByLabel() {}
  async captureScreenshot(path: string) {
    writeFileSync(path, 'mock screenshot');
  }
  async captureTrace(path: string) {
    writeFileSync(path, 'mock trace');
  }
  async diagnostics() {
    return { console: [], network: [] };
  }
}

describe('bounded exploratory testing', () => {
  it('defaults to a 24-step 12-minute budget and a deeper budget for negative exploration', () => {
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    expect(
      explorationBudget({}, workflow.steps.find(({ id }) => id === 'explore')!.timeoutMs)
    ).toEqual({
      maxSteps: 24,
      timeBudgetMs: 720_000
    });
    expect(
      explorationBudget(
        { depth: 'negative' },
        workflow.steps.find(({ id }) => id === 'explore')!.timeoutMs
      )
    ).toEqual({ maxSteps: 40, timeBudgetMs: 1_500_000 });
  });
  it('uses the browser facade within the step and time budgets and records evidence', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    mkdirSync(join(projectRoot, 'observations'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/project-context.md'), '# Context\n');
    writeFileSync(
      join(projectRoot, 'observations/exploration.md'),
      '# Exploration Charter\n\nFocus: login\n'
    );
    writeFileSync(join(projectRoot, 'sources/questions.md'), '# Open Questions\n\nQ-EXISTING\n');
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    const browser = new FakeBrowser();

    const result = await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explore')!,
      command,
      browser,
      { now: () => 1_000 }
    );

    expect(result.status).toBe('succeeded');
    expect(browser.calls).toEqual([
      'navigate:/',
      'snapshot',
      'evidence:session-obs-exp-001',
      'diagnostics'
    ]);
    const exploration = readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8');
    expect(exploration).toContain('# Exploration Charter');
    expect(exploration).toContain('session-obs-exp-001/screenshot.png');
    expect(exploration).toContain('Q-EXP-001');
    const questions = readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8');
    expect(questions).toBe('# Open Questions\n\nQ-EXISTING\n');
    expect(
      existsSync(join(projectRoot, 'observations/evidence/exploration/session-obs-exp-001.json'))
    ).toBe(true);
    const session = JSON.parse(
      readFileSync(
        join(projectRoot, 'observations/evidence/exploration/session-obs-exp-001.json'),
        'utf8'
      )
    );
    expect(session).toMatchObject({
      focus: 'login',
      budget: { maxSteps: 4, timeBudgetMs: 5_000, completedSteps: 4 }
    });

    await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explore')!,
      command,
      browser,
      { now: () => 1_000 }
    );
    const rerunExploration = readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8');
    const rerunQuestions = readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8');
    expect(rerunExploration.match(/OBS-EXP-001/g)).toHaveLength(1);
    expect(rerunExploration.match(/OBS-EXP-002/g)).toHaveLength(1);
    expect(rerunExploration.match(/Q-EXP-001/g)).toHaveLength(1);
    expect(rerunExploration.match(/Q-EXP-002/g)).toHaveLength(1);
    expect(rerunQuestions).toBe('# Open Questions\n\nQ-EXISTING\n');
    expect(rerunExploration).toContain('session-obs-exp-001/screenshot.png');
    expect(rerunExploration).toContain('session-obs-exp-002/screenshot.png');
    expect(
      existsSync(join(projectRoot, 'observations/evidence/exploration/session-obs-exp-001.json'))
    ).toBe(true);
    expect(
      existsSync(join(projectRoot, 'observations/evidence/exploration/session-obs-exp-002.json'))
    ).toBe(true);
  });

  it('uses depth and feature from command parameters as the charter focus', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-focus-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;

    await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'charter')!,
      {
        ...command,
        parameters: {
          classification: 'heuristic-fallback',
          depth: 'deep',
          feature: 'checkout',
          generationRequestId: 'Ev1',
          maxSteps: '4',
          timeBudgetMs: '5000'
        }
      },
      undefined
    );

    const charter = readFileSync(
      join(workspace, command.project.root, 'observations/exploration.md'),
      'utf8'
    );
    expect(charter).toContain('Focus: deep checkout');
    expect(charter).not.toContain('classification:');
  });

  it('blocks exploration when the configured budget is exhausted before an action', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    const browser = new FakeBrowser();
    let tick = 0;

    const result = await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explore')!,
      { ...command, parameters: { maxSteps: 2, timeBudgetMs: 1 } },
      browser,
      { now: () => (tick++ === 0 ? 0 : 2) }
    );

    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'exploration time budget exhausted'
    });
    expect(browser.calls).toEqual([]);
  });

  it('stops before the next browser action when the time budget expires mid-session', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    const browser = new FakeBrowser();
    const ticks = [0, 0, 2];

    const result = await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explore')!,
      { ...command, parameters: { maxSteps: 2, timeBudgetMs: 1 } },
      browser,
      { now: () => ticks.shift() ?? 2 }
    );

    expect(result).toMatchObject({ status: 'succeeded', truncated: true });
    expect(browser.calls).toEqual(['navigate:/']);
    expect(
      existsSync(
        join(
          workspace,
          command.project.root,
          'observations/evidence/exploration/session-obs-exp-001.json'
        )
      )
    ).toBe(true);
  });

  it('stops before the next browser action when the step budget is exhausted', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-'));
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    const browser = new FakeBrowser();

    const result = await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explore')!,
      { ...command, parameters: { area: 'login', maxSteps: 1, timeBudgetMs: 5_000 } },
      browser,
      { now: () => 0 }
    );

    expect(result).toMatchObject({ status: 'succeeded', truncated: true });
    expect(browser.calls).toEqual(['navigate:/']);
    expect(
      readFileSync(join(workspace, command.project.root, 'observations/exploration.md'), 'utf8')
    ).toContain('session-obs-exp-001.json');
  });

  it('runs the complete workflow and renders an evidence-backed report', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-e2e-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    mkdirSync(join(projectRoot, 'observations'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/project-context.md'), '# Context\n');
    writeFileSync(join(projectRoot, 'observations/known-issues.md'), '# Known Issues\n');
    writeFileSync(
      join(projectRoot, 'observations/exploration.md'),
      '# Exploration Charter\n\nFocus: prior\n\n## Session Log\n\n| OBS-EXP-009 | Prior observation must remain. | observed | `old.json` | 2026-08-12 | prior |\n'
    );
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    const browser = new RestrictedBrowserFacade(new FakeBrowserDriver(), {
      baseUrl: 'http://example.test',
      allowedOrigins: ['http://example.test'],
      credentials: {},
      testData: {},
      evidenceDirectory: join(projectRoot, 'observations/evidence/exploration')
    });
    const events = new FakeEventStore();

    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (step, executionCommand) =>
          executeExplorationStep(workspace, step, executionCommand, browser, {
            now: () => 1_000
          })
      },
      events,
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'b'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(result.attempts).toHaveLength(3);
    const report = readFileSync(join(projectRoot, 'derived/reports/exploration.md'), 'utf8');
    expect(report).toContain('OBS-EXP-010');
    expect(report).toContain('session-obs-exp-010/screenshot.png');
    expect(report).toContain('Q-EXP-001');
    expect(report).toContain('OBS-EXP-009');
    expect(report).toContain('Prior observation must remain.');
    expect(existsSync(join(projectRoot, 'derived/reports/exploration.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'derived/scenarios/proposed'))).toBe(true);
  });

  it('appends a new exploration session without rewriting prior observations', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-append-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources/reference'), { recursive: true });
    mkdirSync(join(projectRoot, 'observations'), { recursive: true });
    writeFileSync(join(projectRoot, 'sources/project-context.md'), '# Context\n');
    writeFileSync(join(projectRoot, 'observations/known-issues.md'), '# Known Issues\n');
    const priorObservations =
      '# Exploration Log\n\n| OBS-001 | Existing observation. | observed | `existing.json` | 2026-08-10 | prior |\n';
    writeFileSync(join(projectRoot, 'observations/exploration.md'), priorObservations);
    writeFileSync(join(projectRoot, 'sources/questions.md'), '# Questions\n');
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;
    const browser = new RestrictedBrowserFacade(new FakeBrowserDriver(), {
      baseUrl: 'http://example.test',
      allowedOrigins: ['http://example.test'],
      credentials: {},
      testData: {},
      evidenceDirectory: join(projectRoot, 'observations/evidence/exploration')
    });

    const result = await executeWorkflow(command, {
      loader: { load: () => workflow },
      preconditions: new FakePreconditionChecker(),
      policy: new FakePolicyEnforcer(),
      executor: {
        execute: (step, executionCommand) =>
          executeExplorationStep(workspace, step, executionCommand, browser, {
            now: () => 1_000
          })
      },
      events: new FakeEventStore(),
      outputValidator: new FileSystemOutputValidator(workspace),
      harnessHash: () => 'b'.repeat(64)
    });

    expect(result.status).toBe('succeeded');
    expect(
      readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8').startsWith(
        priorObservations
      )
    ).toBe(true);
  });

  it('records generated open questions without mutating reviewer-owned source questions', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-exploration-questions-'));
    const projectRoot = join(workspace, command.project.root);
    mkdirSync(join(projectRoot, 'sources'), { recursive: true });
    mkdirSync(join(projectRoot, 'observations'), { recursive: true });
    writeFileSync(join(projectRoot, 'observations/exploration.md'), '# Exploration Log\n');
    const reviewerQuestions = '# Questions\n\n| Q-001 | Existing question. | open |\n';
    writeFileSync(join(projectRoot, 'sources/questions.md'), reviewerQuestions);
    const workflow = loadWorkflowDirectory(
      join(process.cwd(), 'workflows'),
      join(process.cwd(), 'harness/profiles.json')
    ).find(({ id }) => id === 'exploratory-testing')!;

    const result = await executeExplorationStep(
      workspace,
      workflow.steps.find(({ id }) => id === 'explore')!,
      command,
      new FakeBrowser(),
      { now: () => 1_000 }
    );

    expect(result.status).toBe('succeeded');
    expect(readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8')).toBe(reviewerQuestions);
    expect(readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8')).toContain(
      'Q-EXP-001'
    );
  });
});
