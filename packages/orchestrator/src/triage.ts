import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import {
  resolvePlaywrightSuite,
  summarizePlaywrightRun,
  type PlaywrightRunner
} from '../../playwright/src/index.js';
import type { StepExecutionResult } from './execution.js';

export interface FailureFingerprintEntry {
  title: string;
  projectName: string;
  file: string;
  error: string;
}

export interface FailureFingerprint {
  version: 1;
  fingerprint: string;
  sourceRunId: string;
  projectId: string;
  failureCount: number;
  failures: FailureFingerprintEntry[];
}

export interface TriageRegressionValidator {
  observeRed(request: {
    workspace: string;
    projectId: string;
    candidatePath: string;
    title: string;
    fingerprint: string;
    signal?: AbortSignal;
  }): Promise<
    | { status: 'red'; evidence: string[] }
    | { status: 'not-red'; error: string; evidence?: string[] }
  >;
}

export class PlaywrightTriageRegressionValidator implements TriageRegressionValidator {
  constructor(
    private readonly runner: PlaywrightRunner,
    private readonly targetBaseUrl: string,
    private readonly webServer?: { command: string; url: string }
  ) {}

  async observeRed(
    request: Parameters<TriageRegressionValidator['observeRed']>[0]
  ): Promise<Awaited<ReturnType<TriageRegressionValidator['observeRed']>>> {
    const reportPath = join(
      request.workspace,
      `projects/${request.projectId}/observations/evidence/reproductions/red-results.json`
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    if (existsSync(reportPath)) unlinkSync(reportPath);
    const suite = resolvePlaywrightSuite(request.title);
    const run = await this.runner.run({
      workspace: request.workspace,
      projectId: request.projectId,
      targetBaseUrl: this.targetBaseUrl,
      reportPath,
      testPaths: [request.candidatePath],
      ...(request.signal ? { signal: request.signal } : {}),
      ...(suite.grep ? { grep: suite.grep } : {}),
      ...(this.webServer ? { webServer: this.webServer } : {})
    });
    if (!existsSync(reportPath)) {
      return {
        status: 'not-red',
        error: run.stderr ?? 'Playwright produced no regression failure report'
      };
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const summary = summarizePlaywrightRun(report, run);
    if (run.status !== 'failed' || summary.failed === 0) {
      return {
        status: 'not-red',
        error: 'regression candidate did not reproduce a failing test',
        evidence: [reportPath, ...summary.evidence]
      };
    }
    const observedFingerprint = fingerprintFailureReport({
      projectId: request.projectId,
      sourceRunId: 'regression-validation',
      report
    }).fingerprint;
    if (observedFingerprint !== request.fingerprint) {
      return {
        status: 'not-red',
        error: 'observed regression failure does not match the source fingerprint',
        evidence: [reportPath, ...summary.evidence]
      };
    }
    return { status: 'red', evidence: [reportPath, ...summary.evidence] };
  }
}

interface ReportResult {
  status?: string;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
}

interface ReportTest {
  status?: string;
  projectName?: string;
  results?: ReportResult[];
}

interface ReportSpec {
  title?: string;
  file?: string;
  tests?: ReportTest[];
}

interface ReportSuite {
  title?: string;
  file?: string;
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}

const generatedMarkdown = (body: string): string => {
  const normalized = `\n\n${body.trim()}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

const normalizeError = (value: string): string => {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  return (
    value
      .replace(ansiPattern, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? 'Unknown Playwright failure'
  )
    .replace(/\b\d+(?:\.\d+)?ms\b/g, '<duration>')
    .replace(/\s+/g, ' ')
    .trim();
};

function collectFailures(suite: ReportSuite): FailureFingerprintEntry[] {
  const entries = (suite.specs ?? []).flatMap((spec) =>
    (spec.tests ?? []).flatMap((test) => {
      const final = test.results?.at(-1);
      const failed =
        test.status === 'unexpected' || !['passed', 'skipped'].includes(final?.status ?? '');
      if (!failed) return [];
      const message =
        final?.errors?.find(({ message }) => message)?.message ?? final?.error?.message ?? '';
      return [
        {
          title: spec.title?.trim() || 'Untitled Playwright test',
          projectName: test.projectName?.trim() || 'default',
          file: spec.file?.trim() || suite.file?.trim() || suite.title?.trim() || 'unknown',
          error: normalizeError(message)
        }
      ];
    })
  );
  return [...entries, ...(suite.suites ?? []).flatMap(collectFailures)];
}

export function fingerprintFailureReport(input: {
  projectId: string;
  sourceRunId: string;
  report: unknown;
}): FailureFingerprint {
  const report = input.report as { suites?: ReportSuite[] };
  const failures = (report.suites ?? [])
    .flatMap(collectFailures)
    .sort((left, right) =>
      `${left.title}\u0000${left.projectName}\u0000${left.error}`.localeCompare(
        `${right.title}\u0000${right.projectName}\u0000${right.error}`
      )
    );
  if (failures.length === 0) throw new Error('Playwright report contains no failed tests');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ projectId: input.projectId, failures }))
    .digest('hex');
  return {
    version: 1,
    fingerprint,
    sourceRunId: input.sourceRunId,
    projectId: input.projectId,
    failureCount: failures.length,
    failures
  };
}

export async function executeTriageStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand,
  regressionValidator?: TriageRegressionValidator,
  signal?: AbortSignal
): Promise<StepExecutionResult> {
  if (command.intent !== 'triage-failure') {
    return { status: 'blocked', reason: 'unsupported deterministic triage step' };
  }
  const sourceRunId =
    typeof command.parameters.sourceRunId === 'string' ? command.parameters.sourceRunId.trim() : '';
  if (!sourceRunId) return { status: 'blocked', reason: 'triage requires a source run id' };

  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: path.replaceAll('{projectId}', command.project.id)
  }));
  const fingerprintPath = join(
    workspace,
    command.project.root,
    'observations/evidence/reproductions/fingerprint.json'
  );
  if (step.id === 'explain') {
    if (!existsSync(fingerprintPath)) {
      return { status: 'failed', error: 'failure fingerprint is missing' };
    }
    const fingerprint = JSON.parse(readFileSync(fingerprintPath, 'utf8')) as FailureFingerprint;
    const outputPath = join(workspace, outputs[0]!.path);
    const body = [
      '# Triage explanation',
      '',
      'Deterministic Mock Mode explanation derived after fingerprinting.',
      '',
      `Fingerprint: \`${fingerprint.fingerprint}\``,
      `Source run: \`${fingerprint.sourceRunId}\``,
      `Failed tests: ${fingerprint.failureCount}`,
      '',
      ...fingerprint.failures.flatMap((failure) => [
        `## ${failure.title}`,
        '',
        `Observed error: ${failure.error}`,
        `Source test: \`${failure.file}\``,
        ''
      ])
    ].join('\n');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, generatedMarkdown(body));
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'reproduce') {
    if (!existsSync(fingerprintPath)) {
      return { status: 'failed', error: 'failure fingerprint is missing' };
    }
    const fingerprint = JSON.parse(readFileSync(fingerprintPath, 'utf8')) as FailureFingerprint;
    const failure = fingerprint.failures[0];
    if (!failure) return { status: 'failed', error: 'failure fingerprint has no cases' };
    const projectRoot = resolve(workspace, command.project.root);
    const reportedFile = failure.file.replaceAll('\\', '/');
    const prefixes = [`projects/${command.project.id}/`, `${command.project.id}/`];
    const matchedPrefix = prefixes.find((prefix) => reportedFile.startsWith(prefix));
    const projectRelativeFile = matchedPrefix
      ? reportedFile.slice(matchedPrefix.length)
      : reportedFile;
    const sourceTestPath = resolve(projectRoot, projectRelativeFile);
    if (
      !sourceTestPath.startsWith(`${projectRoot}${sep}`) ||
      !/\.spec\.ts$/.test(sourceTestPath) ||
      !existsSync(sourceTestPath)
    ) {
      return { status: 'failed', error: `source test is unavailable: ${failure.file}` };
    }

    const candidatePath = join(
      command.project.root,
      'tests/regressions',
      `${fingerprint.fingerprint.slice(0, 12)}.spec.ts`
    );
    const absoluteCandidatePath = join(workspace, candidatePath);
    let sourceImport = relative(dirname(absoluteCandidatePath), sourceTestPath)
      .replaceAll('\\', '/')
      .replace(/\.ts$/, '.js');
    if (!sourceImport.startsWith('.')) sourceImport = `./${sourceImport}`;
    mkdirSync(dirname(absoluteCandidatePath), { recursive: true });
    writeFileSync(
      absoluteCandidatePath,
      [
        '// Generated regression candidate; imports the observed failing test without changing its oracle.',
        `// Failure fingerprint: ${fingerprint.fingerprint}`,
        `// Source run: ${fingerprint.sourceRunId}`,
        `import '${sourceImport}';`,
        ''
      ].join('\n')
    );

    const draftPath = join(
      workspace,
      outputs.find(({ artifact }) => artifact === 'evidence')!.path
    );
    mkdirSync(dirname(draftPath), { recursive: true });
    writeFileSync(
      draftPath,
      `${JSON.stringify(
        {
          version: 1,
          fingerprint: fingerprint.fingerprint,
          sourceRunId: fingerprint.sourceRunId,
          candidatePath,
          sourceTest: failure.file,
          title: failure.title
        },
        null,
        2
      )}\n`
    );
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'validate-red') {
    if (!regressionValidator) {
      return { status: 'failed', error: 'regression red-state validator is unavailable' };
    }
    const draftPath = join(
      workspace,
      command.project.root,
      'observations/evidence/reproductions/draft.json'
    );
    if (!existsSync(fingerprintPath) || !existsSync(draftPath)) {
      return { status: 'failed', error: 'regression candidate evidence is incomplete' };
    }
    const projectRoot = resolve(workspace, command.project.root);
    const fingerprint = JSON.parse(readFileSync(fingerprintPath, 'utf8')) as FailureFingerprint;
    const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as {
      fingerprint: string;
      sourceRunId: string;
      candidatePath: string;
      sourceTest: string;
      title: string;
    };
    if (
      draft.fingerprint !== fingerprint.fingerprint ||
      draft.sourceRunId !== fingerprint.sourceRunId
    ) {
      return { status: 'failed', error: 'regression candidate does not match the fingerprint' };
    }
    const expectedCandidatePath = join(
      command.project.root,
      'tests/regressions',
      `${fingerprint.fingerprint.slice(0, 12)}.spec.ts`
    );
    const matchedFailure = fingerprint.failures.find(
      (failure) => failure.title === draft.title && failure.file === draft.sourceTest
    );
    if (draft.candidatePath !== expectedCandidatePath || !matchedFailure) {
      return { status: 'failed', error: 'regression candidate does not match the fingerprint' };
    }

    const observation = await regressionValidator.observeRed({
      workspace,
      projectId: command.project.id,
      candidatePath: draft.candidatePath,
      title: draft.title,
      fingerprint: fingerprint.fingerprint,
      ...(signal ? { signal } : {})
    });
    if (observation.status !== 'red') {
      return { status: 'failed', error: observation.error };
    }

    const evidenceDirectory = join(projectRoot, 'observations/evidence/reproductions');
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      join(evidenceDirectory, 'reproduction.json'),
      `${JSON.stringify(
        {
          version: 1,
          fingerprint: fingerprint.fingerprint,
          sourceRunId: fingerprint.sourceRunId,
          candidatePath: draft.candidatePath,
          sourceTest: draft.sourceTest,
          title: draft.title,
          observedStatus: 'red',
          evidence: observation.evidence
        },
        null,
        2
      )}\n`
    );

    const knownIssuesPath = join(projectRoot, 'observations/known-issues.md');
    mkdirSync(dirname(knownIssuesPath), { recursive: true });
    if (!existsSync(knownIssuesPath)) writeFileSync(knownIssuesPath, '# Known Issues\n');
    if (!readFileSync(knownIssuesPath, 'utf8').includes(fingerprint.fingerprint)) {
      appendFileSync(
        knownIssuesPath,
        [
          '',
          `## BUG-${fingerprint.fingerprint.slice(0, 12)}: ${draft.title}`,
          '',
          '- Status: reproduced',
          `- Fingerprint: \`${fingerprint.fingerprint}\``,
          `- Source run: \`${fingerprint.sourceRunId}\``,
          `- Regression candidate: \`${draft.candidatePath}\``,
          `- Red evidence: ${observation.evidence.map((path) => `\`${path}\``).join(', ')}`,
          ''
        ].join('\n')
      );
    }
    const questionsPath = join(projectRoot, 'sources/questions.md');
    mkdirSync(dirname(questionsPath), { recursive: true });
    if (!existsSync(questionsPath)) writeFileSync(questionsPath, '# Open Questions\n');
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'report') {
    const reproductionPath = join(
      workspace,
      command.project.root,
      'observations/evidence/reproductions/reproduction.json'
    );
    if (!existsSync(fingerprintPath) || !existsSync(reproductionPath)) {
      return { status: 'failed', error: 'triage evidence is incomplete' };
    }
    const fingerprint = JSON.parse(readFileSync(fingerprintPath, 'utf8')) as FailureFingerprint;
    const reproduction = JSON.parse(readFileSync(reproductionPath, 'utf8')) as {
      candidatePath: string;
      observedStatus: string;
      evidence: string[];
    };
    const body = [
      '# Triage report',
      '',
      `Source run: \`${fingerprint.sourceRunId}\``,
      `Failure fingerprint: \`${fingerprint.fingerprint}\``,
      `Failed tests: ${fingerprint.failureCount}`,
      `Observed regression state: **${reproduction.observedStatus}**`,
      `Regression candidate: \`${reproduction.candidatePath}\``,
      '',
      '## Evidence',
      '',
      ...reproduction.evidence.map((path) => `- \`${path}\``),
      ''
    ].join('\n');
    const outputPath = join(workspace, outputs[0]!.path);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, generatedMarkdown(body));
    return { status: 'succeeded', outputs };
  }

  if (step.id !== 'fingerprint') {
    return { status: 'blocked', reason: 'unsupported deterministic triage step' };
  }

  const reportPath = join(
    workspace,
    command.project.root,
    'observations/evidence/test-runs/results.json'
  );
  if (!existsSync(reportPath)) {
    return { status: 'failed', error: 'source Playwright report is missing' };
  }
  const fingerprint = fingerprintFailureReport({
    projectId: command.project.id,
    sourceRunId,
    report: JSON.parse(readFileSync(reportPath, 'utf8'))
  });
  const artifactPath = join(workspace, outputs[0]!.path);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(fingerprint, null, 2)}\n`);
  return { status: 'succeeded', outputs };
}
