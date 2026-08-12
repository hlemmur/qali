import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  NormalizedCommand,
  WorkflowStep
} from '../../contracts/src/index.js';

export interface ExplorationBrowser {
  navigate(path: string): Promise<{ url: string }>;
  accessibilitySnapshot(): Promise<{ untrustedPageData: string }>;
  captureEvidence(
    evidenceId: string,
    options: { screenshot: boolean; trace: boolean }
  ): Promise<{ evidenceId: string; artifacts: string[] }>;
  readDiagnostics(): Promise<{
    untrustedConsole: Array<{ level: string; text: string }>;
    untrustedNetwork: Array<{ method: string; url: string; status?: number; blocked?: boolean }>;
  }>;
}

interface ExplorationClock {
  now(): number;
}

const expand = (path: string, command: NormalizedCommand): string =>
  path.replaceAll('{projectId}', command.project.id);

const generatedMarkdown = (body: string): string => {
  const normalized = `\n\n${body.trim()}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

const positiveInteger = (value: unknown, fallback: number, maximum: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;

export async function executeExplorationStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand,
  browser: ExplorationBrowser,
  clock: ExplorationClock = { now: () => Date.now() }
) {
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const projectRoot = join(workspace, command.project.root);
  const focus = typeof command.parameters.focus === 'string' ? command.parameters.focus : 'project';
  if (step.id === 'charter') {
    const explorationPath = join(projectRoot, 'observations/exploration.md');
    mkdirSync(dirname(explorationPath), { recursive: true });
    writeFileSync(
      explorationPath,
      `# Exploration Charter\n\nFocus: ${focus}\n\nMethod: bounded black-box exploration through the restricted browser facade.\n`
    );
    return { status: 'succeeded' as const, outputs };
  }
  if (step.id === 'report') {
    const exploration = readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8');
    const questions = readFileSync(join(projectRoot, 'sources/questions.md'), 'utf8');
    const reportPath = join(projectRoot, 'derived/reports/exploration.md');
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, renderExplorationReport(exploration, questions));
    return { status: 'succeeded' as const, outputs };
  }
  if (step.id !== 'explore') {
    return { status: 'blocked' as const, reason: `unsupported exploration step: ${step.id}` };
  }

  const startedAt = clock.now();
  const maxSteps = positiveInteger(command.parameters.maxSteps, 10, 50);
  const timeBudgetMs = positiveInteger(command.parameters.timeBudgetMs, 300_000, step.timeoutMs);
  const ensureBudget = (completedSteps: number) => {
    if (completedSteps >= maxSteps) return 'exploration step budget exhausted';
    if (clock.now() - startedAt >= timeBudgetMs) return 'exploration time budget exhausted';
    return undefined;
  };
  const budgetFailure = ensureBudget(0);
  if (budgetFailure) return { status: 'blocked' as const, reason: budgetFailure };

  const evidenceDirectory = join(projectRoot, 'observations/evidence/exploration');
  mkdirSync(evidenceDirectory, { recursive: true });
  const navigation = await browser.navigate('/');
  const snapshot = await browser.accessibilitySnapshot();
  const evidence = await browser.captureEvidence('session-home', {
    screenshot: true,
    trace: false
  });
  const diagnostics = await browser.readDiagnostics();
  const observedAt = command.receivedAt.slice(0, 10);
  const evidenceRefs = evidence.artifacts.map(
    (artifact) => `observations/evidence/exploration/${artifact}`
  );
  writeFileSync(
    join(evidenceDirectory, 'session.json'),
    `${JSON.stringify(
      {
        version: 1,
        focus,
        budget: { maxSteps, timeBudgetMs, completedSteps: 1 },
        page: { url: navigation.url, accessibilitySnapshot: snapshot.untrustedPageData },
        evidence: evidenceRefs,
        diagnostics
      },
      null,
      2
    )}\n`
  );
  const explorationPath = join(projectRoot, 'observations/exploration.md');
  mkdirSync(dirname(explorationPath), { recursive: true });
  writeFileSync(
    explorationPath,
    [
      '# Exploration Log',
      '',
      `Focus: ${focus}`,
      '',
      '| ID | Observation | Status | Evidence | Observed at | Session |',
      '| --- | --- | --- | --- | --- | --- |',
      `| OBS-EXP-001 | Browser facade captured the accessible home-page state at \`${navigation.url}\`. | observed | \`${evidenceRefs[0] ?? 'observations/evidence/exploration/session.json'}\` | ${observedAt} | bounded-exploration |`,
      ''
    ].join('\n')
  );
  const questionsPath = join(projectRoot, 'sources/questions.md');
  mkdirSync(dirname(questionsPath), { recursive: true });
  writeFileSync(
    questionsPath,
    [
      '# Open Questions',
      '',
      '| ID | Question | Status | Blocking | Evidence |',
      '| --- | --- | --- | --- | --- |',
      `| Q-EXP-001 | What expected behavior should be validated for the ${focus} focus? | open | no | \`observations/evidence/exploration/session.json\` |`,
      ''
    ].join('\n')
  );
  return { status: 'succeeded' as const, outputs };
}

export function renderExplorationReport(exploration: string, questions: string): string {
  return generatedMarkdown(
    `# Exploration Report\n\n## Observations\n\n${exploration.trim()}\n\n## Open Questions\n\n${questions.trim()}`
  );
}
