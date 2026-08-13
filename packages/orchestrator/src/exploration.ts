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

const appendMarkdown = (existing: string, section: string): string => {
  const separator =
    existing.length === 0
      ? ''
      : existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
          ? '\n'
          : '\n\n';
  return `${existing}${separator}${section.trim()}\n`;
};

const positiveInteger = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const cleanFocusValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/[\r\n|`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
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

function nextGovernedId(content: string, prefix: 'OBS-EXP' | 'Q-EXP'): string {
  const pattern = new RegExp(`\\b${prefix}-(\\d{3})\\b`, 'g');
  const used = [...content.matchAll(pattern)].map((match) => Number(match[1]));
  const next = Math.max(0, ...used) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
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
    const existing = existsSync(explorationPath) ? readFileSync(explorationPath, 'utf8') : '';
    const charter = `## Exploration Charter\n\nFocus: ${focus}\n\nMethod: bounded black-box exploration through the restricted browser facade.`;
    writeFileSync(explorationPath, appendMarkdown(existing, charter));
    return { status: 'succeeded' as const, outputs };
  }
  if (step.id === 'report') {
    const exploration = readFileSync(join(projectRoot, 'observations/exploration.md'), 'utf8');
    const questionsPath = join(projectRoot, 'sources/questions.md');
    const questions = existsSync(questionsPath)
      ? readFileSync(questionsPath, 'utf8')
      : '# Questions\n\nNo reviewer-authored questions recorded.\n';
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
  let completedSteps = 0;
  const ensureBudget = () => {
    if (completedSteps >= maxSteps) return 'exploration step budget exhausted';
    if (clock.now() - startedAt >= timeBudgetMs) return 'exploration time budget exhausted';
    return undefined;
  };
  const blockedByBudget = () => {
    const reason = ensureBudget();
    return reason ? ({ status: 'blocked' as const, reason } as const) : undefined;
  };

  const evidenceDirectory = join(projectRoot, 'observations/evidence/exploration');
  mkdirSync(evidenceDirectory, { recursive: true });
  const explorationPath = join(projectRoot, 'observations/exploration.md');
  const questionsPath = join(projectRoot, 'sources/questions.md');
  const existingExploration = existsSync(explorationPath)
    ? readFileSync(explorationPath, 'utf8')
    : '# Exploration Log';
  const existingQuestions = existsSync(questionsPath)
    ? readFileSync(questionsPath, 'utf8').trim()
    : '# Open Questions';
  const observationId = nextGovernedId(existingExploration, 'OBS-EXP');
  const questionId = nextGovernedId(`${existingExploration}\n${existingQuestions}`, 'Q-EXP');
  const sessionId = `session-${observationId.toLowerCase()}`;
  const sessionReference = `observations/evidence/exploration/${sessionId}.json`;
  const session: {
    navigation?: { url: string };
    snapshot?: { untrustedPageData: string };
    evidence?: { evidenceId: string; artifacts: string[] };
    diagnostics?: Awaited<ReturnType<ExplorationBrowser['readDiagnostics']>>;
  } = {};
  const observedAt = command.receivedAt.slice(0, 10);
  const finish = (truncationReason?: string) => {
    const evidenceRefs = (session.evidence?.artifacts ?? []).map(
      (artifact) => `observations/evidence/exploration/${artifact}`
    );
    writeFileSync(
      join(evidenceDirectory, `${sessionId}.json`),
      `${JSON.stringify(
        {
          version: 1,
          focus,
          status: truncationReason ? 'truncated' : 'complete',
          ...(truncationReason ? { truncationReason } : {}),
          budget: { maxSteps, timeBudgetMs, completedSteps },
          ...(session.navigation
            ? {
                page: {
                  url: session.navigation.url,
                  ...(session.snapshot
                    ? { accessibilitySnapshot: session.snapshot.untrustedPageData }
                    : {})
                }
              }
            : {}),
          evidence: evidenceRefs,
          ...(session.diagnostics ? { diagnostics: session.diagnostics } : {})
        },
        null,
        2
      )}\n`
    );
    const evidenceReference = evidenceRefs[0] ?? sessionReference;
    const accessibleNodes = session.snapshot
      ? session.snapshot.untrustedPageData.split('\n').filter(Boolean).length
      : 0;
    mkdirSync(dirname(explorationPath), { recursive: true });
    writeFileSync(
      explorationPath,
      appendMarkdown(
        existingExploration,
        [
          '## Session Log',
          '',
          `Focus: ${focus}. Accessible nodes observed: ${accessibleNodes}.${truncationReason ? ` Session truncated: ${truncationReason}.` : ''}`,
          '',
          '| ID | Observation | Status | Evidence | Observed at | Session |',
          '| --- | --- | --- | --- | --- | --- |',
          `| ${observationId} | Browser facade captured ${session.snapshot ? 'the accessible home-page state' : 'a partial home-page session'}${session.navigation ? ` at \`${session.navigation.url}\`` : ''}. | observed | \`${evidenceReference}\` | ${observedAt} | bounded-exploration |`,
          '',
          '## Open Questions',
          '',
          '| ID | Question | Status | Blocking | Evidence |',
          '| --- | --- | --- | --- | --- |',
          `| ${questionId} | What expected behavior should be validated for the ${focus} focus? | open | no | \`${sessionReference}\` |`,
          ''
        ].join('\n')
      )
    );
    return {
      status: 'succeeded' as const,
      outputs,
      ...(truncationReason ? { truncated: true as const, truncationReason } : {})
    };
  };

  let budgetFailure = blockedByBudget();
  if (budgetFailure) return budgetFailure;
  session.navigation = await browser.navigate('/');
  completedSteps += 1;
  budgetFailure = blockedByBudget();
  if (budgetFailure) return finish(budgetFailure.reason);
  session.snapshot = await browser.accessibilitySnapshot();
  completedSteps += 1;
  budgetFailure = blockedByBudget();
  if (budgetFailure) return finish(budgetFailure.reason);
  session.evidence = await browser.captureEvidence(sessionId, {
    screenshot: true,
    trace: false
  });
  completedSteps += 1;
  budgetFailure = blockedByBudget();
  if (budgetFailure) return finish(budgetFailure.reason);
  session.diagnostics = await browser.readDiagnostics();
  completedSteps += 1;
  return finish();
}

export function renderExplorationReport(exploration: string, questions: string): string {
  return generatedMarkdown(
    `# Exploration Report\n\n## Observations\n\n${exploration.trim()}\n\n## Open Questions\n\n${questions.trim()}`
  );
}
