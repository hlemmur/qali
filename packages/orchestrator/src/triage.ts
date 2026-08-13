import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
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
  command: NormalizedCommand
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
    const normalized = `\n\n${body.trim()}\n`;
    const hash = createHash('sha256').update(normalized).digest('hex');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`);
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
