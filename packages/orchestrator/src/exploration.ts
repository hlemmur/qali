import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';

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

const positiveInteger = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const cleanFocusValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\r\n|`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned || undefined;
};

function explorationFocus(parameters: NormalizedCommand['parameters']): string {
  for (const key of ['focus', 'area', 'charter', 'journey', 'suite']) {
    const value = cleanFocusValue(parameters[key]);
    if (value) return value;
  }
  const declarative = Object.entries(parameters)
    .filter(([key]) => !['maxSteps', 'timeBudgetMs'].includes(key))
    .flatMap(([key, value]) => {
      const cleaned = cleanFocusValue(value);
      return cleaned ? [`${key}: ${cleaned}`] : [];
    });
  return declarative.join(', ').slice(0, 120) || 'project';
}

export async function executeExplorationStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand,
  browser: ExplorationBrowser | undefined,
  clock: ExplorationClock = { now: () => Date.now() }
) {
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const projectRoot = join(workspace, command.project.root);
  const focus = explorationFocus(command.parameters);
  if (step.id === 'charter') {
    const explorationPath = join(projectRoot, 'observations/exploration.md');
    mkdirSync(dirname(explorationPath), { recursive: true });
    const existing = existsSync(explorationPath)
      ? readFileSync(explorationPath, 'utf8')
      : '';
    const sessionOffset = existing.indexOf('## Session Log');
    const priorSessions = sessionOffset >= 0 ? existing.slice(sessionOffset).trim() : '';
    const charter = `# Exploration Charter\n\nFocus: ${focus}\n\nMethod: bounded black-box exploration through the restricted browser facade.`;
    writeFileSync(
      explorationPath,
      `${charter}${priorSessions ? `\n\n${priorSessions}` : ''}\n`
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
  if (!browser) return { status: 'blocked' as const, reason: 'browser facade is unavailable' };

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
  if (clock.now() - startedAt >= timeBudgetMs) {
    return { status: 'blocked' as const, reason: 'exploration time budget exhausted' };
  }
  const snapshot = await browser.accessibilitySnapshot();
  if (clock.now() - startedAt >= timeBudgetMs) {
    return { status: 'blocked' as const, reason: 'exploration time budget exhausted' };
  }
  const evidence = await browser.captureEvidence('session-home', {
    screenshot: true,
    trace: false
  });
  if (clock.now() - startedAt >= timeBudgetMs) {
    return { status: 'blocked' as const, reason: 'exploration time budget exhausted' };
  }
  const diagnostics = await browser.readDiagnostics();
  if (clock.now() - startedAt >= timeBudgetMs) {
    return { status: 'blocked' as const, reason: 'exploration time budget exhausted' };
  }
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
  const existingExploration = existsSync(explorationPath)
    ? readFileSync(explorationPath, 'utf8').trim()
    : '# Exploration Log';
  writeFileSync(
    explorationPath,
    [
      existingExploration,
      '',
      '## Session Log',
      '',
      `Focus: ${focus}. Accessible nodes observed: ${snapshot.untrustedPageData.split('\n').filter(Boolean).length}.`,
      '',
      '| ID | Observation | Status | Evidence | Observed at | Session |',
      '| --- | --- | --- | --- | --- | --- |',
      `| OBS-EXP-001 | Browser facade captured the accessible home-page state at \`${navigation.url}\`. | observed | \`${evidenceRefs[0] ?? 'observations/evidence/exploration/session.json'}\` | ${observedAt} | bounded-exploration |`,
      ''
    ].join('\n')
  );
  const questionsPath = join(projectRoot, 'sources/questions.md');
  mkdirSync(dirname(questionsPath), { recursive: true });
  const existingQuestions = existsSync(questionsPath)
    ? readFileSync(questionsPath, 'utf8').trim()
    : '# Open Questions';
  writeFileSync(
    questionsPath,
    [
      existingQuestions,
      '',
      '## Exploration Questions',
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
