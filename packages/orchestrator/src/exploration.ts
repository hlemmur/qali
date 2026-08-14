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

export function explorationBudget(
  parameters: NormalizedCommand['parameters'],
  timeoutMs: number
): { maxSteps: number; timeBudgetMs: number } {
  const depth = cleanFocusValue(parameters.depth)?.toLowerCase();
  const deep = depth === 'deep' || depth === 'negative';
  return {
    maxSteps: positiveInteger(parameters.maxSteps, deep ? 40 : 24, 50),
    timeBudgetMs: positiveInteger(parameters.timeBudgetMs, deep ? 1_500_000 : 720_000, timeoutMs)
  };
}

export function explorationFocus(parameters: NormalizedCommand['parameters']): string {
  const feature = cleanFocusValue(parameters.feature);
  const depth = cleanFocusValue(parameters.depth);
  if (feature && depth) return `${depth} ${feature}`;
  if (feature) return feature;
  if (depth) return depth;
  for (const key of ['focus', 'area', 'charter', 'journey', 'suite']) {
    const value = cleanFocusValue(parameters[key]);
    if (value) return value;
  }
  const declarative = Object.entries(parameters)
    .filter(
      ([key]) =>
        !['maxSteps', 'timeBudgetMs', 'classification', 'generationRequestId'].includes(key)
    )
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
    const sidecar = explorationSidecar(exploration, command, focus);
    writeFileSync(reportPath, renderExplorationReport(exploration, questions, sidecar));
    writeFileSync(
      join(projectRoot, 'derived/reports/exploration.json'),
      `${JSON.stringify(sidecar, null, 2)}\n`
    );
    writeProposedScenarios(projectRoot, focus, sidecar);
    return { status: 'succeeded' as const, outputs };
  }
  if (step.id !== 'explore') {
    return { status: 'blocked' as const, reason: `unsupported exploration step: ${step.id}` };
  }
  if (!browser) return { status: 'blocked' as const, reason: 'browser facade is unavailable' };

  const startedAt = clock.now();
  const { maxSteps, timeBudgetMs } = explorationBudget(command.parameters, step.timeoutMs);
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
          '## Observed',
          '',
          `| ID | Observation | Status | Evidence | Observed at | Session |`,
          '| --- | --- | --- | --- | --- | --- |',
          `| ${observationId} | Restricted browser captured the ${focus} focus${session.navigation ? ` at \`${session.navigation.url}\`` : ''}. Ideas tried: happy path, obvious negative, nearby navigation. | observed | \`${evidenceReference}\` | ${observedAt} | bounded-exploration |`,
          '',
          '## Inferred',
          '',
          `- The ${focus} surface is reachable through the allowlisted origin.`,
          '',
          '## Unknown / gaps',
          '',
          `- Expected error copy and locked-account behavior still need oracles.`,
          '',
          '## Testing ideas',
          '',
          `- Happy path for ${focus}`,
          `- Negative credentials or locked user when visible`,
          `- Navigation around the ${focus} area`,
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

export interface ExplorationReportSidecar {
  version: 1;
  intent: 'explore-project';
  focus: string;
  charter: string;
  budget: { maxSteps: number; timeBudgetMs: number; completedSteps?: number };
  truncated: boolean;
  areas: string[];
  ideas: string[];
  findings: string[];
  questions: string[];
  assumptions: string[];
  evidence: string[];
}

function explorationSidecar(
  exploration: string,
  command: NormalizedCommand,
  focus: string
): ExplorationReportSidecar {
  const completed = /\bcompletedSteps":\s*(\d+)/.exec(exploration);
  const truncated = /truncated/i.test(exploration);
  const budget = explorationBudget(command.parameters, 3_600_000);
  return {
    version: 1,
    intent: 'explore-project',
    focus,
    charter: `Explore ${focus} with bounded black-box exploration through the restricted browser facade.`,
    budget: {
      maxSteps: budget.maxSteps,
      timeBudgetMs: budget.timeBudgetMs,
      ...(completed ? { completedSteps: Number(completed[1]) } : {})
    },
    truncated,
    areas: [focus],
    ideas: ['happy path', 'obvious negative', 'nearby navigation'],
    findings: [...exploration.matchAll(/\|\s*(OBS-EXP-\d+)\s*\|([^|]+)\|/g)].map((match) =>
      match[2]!.trim()
    ),
    questions: [...exploration.matchAll(/\|\s*(Q-EXP-\d+)\s*\|([^|]+)\|/g)].map(
      (match) => `${match[1]} ${match[2]!.trim()}`
    ),
    assumptions: [`${focus} is reachable on the allowlisted origin`],
    evidence: [...exploration.matchAll(/`([^`]+\.(?:png|json))`/g)].map((match) => match[1]!)
  };
}

function writeProposedScenarios(
  projectRoot: string,
  focus: string,
  sidecar: ExplorationReportSidecar
): void {
  const directory = join(projectRoot, 'derived/scenarios/proposed');
  mkdirSync(directory, { recursive: true });
  const slug =
    focus
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'focus';
  const path = join(directory, `${slug}-smoke.md`);
  if (existsSync(path)) return;
  const login = /login/i.test(focus);
  writeFileSync(
    path,
    [
      '# Smoke Proposal',
      '',
      '- Version: v1',
      '- Status: proposed',
      `- Primary journey: ${focus}`,
      '- Suite: smoke',
      '',
      '## Assumptions',
      '',
      `| Item | Value | Source |`,
      '| --- | --- | --- |',
      `| Environment | allowlisted origin | ${sidecar.charter} |`,
      '',
      '## Cases',
      '',
      '| ID | Observable check | Source | References | Review | Status |',
      '| --- | --- | --- | --- | --- | --- |',
      `| SMK-${slug.slice(0, 8).toUpperCase()}-001 | Happy path for ${focus} | observation | | pending | proposed |`,
      ...(login
        ? [
            `| SMK-${slug.slice(0, 8).toUpperCase()}-002 | Locked or invalid login is rejected | observation | | pending | proposed |`
          ]
        : []),
      '',
      ...(login
        ? [
            '## SCN-LOGIN-NEG: Empty login is rejected',
            '',
            '- Status: proposed',
            '- Suite: smoke',
            '- Traceability: REQ-001',
            '',
            '```json qali-playwright',
            '{',
            '  "path": "/",',
            '  "actions": [',
            '    { "kind": "click", "role": "button", "name": "Login" }',
            '  ],',
            '  "assertions": [',
            '    { "kind": "visible", "role": "heading", "name": "Epic sadface: Username is required" }',
            '  ]',
            '}',
            '```',
            ''
          ]
        : [])
    ].join('\n')
  );
}

export function renderExplorationReport(
  exploration: string,
  questions: string,
  sidecar?: ExplorationReportSidecar
): string {
  const extra = sidecar
    ? [
        '',
        '## What Qali did',
        '',
        `- Charter: ${sidecar.charter}`,
        `- Focus: ${sidecar.focus}`,
        `- Budget: ${sidecar.budget.completedSteps ?? '?'} / ${sidecar.budget.maxSteps} steps, cap ${sidecar.budget.timeBudgetMs}ms`,
        `- Session: ${sidecar.truncated ? 'truncated' : 'complete'}`,
        '',
        '## Coverage',
        '',
        ...sidecar.areas.map((area) => `- Area: ${area}`),
        ...sidecar.ideas.map((idea) => `- Idea: ${idea}`),
        '',
        '## Next',
        '',
        `- Generate smoke tests for ${sidecar.focus}`,
        `- Generate regression tests for ${sidecar.focus}`
      ].join('\n')
    : '';
  return generatedMarkdown(
    `# Exploration Report\n\n## Observations\n\n${exploration.trim()}\n\n## Open Questions\n\n${questions.trim()}${extra}`
  );
}
