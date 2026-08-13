import { createHash } from 'node:crypto';

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
