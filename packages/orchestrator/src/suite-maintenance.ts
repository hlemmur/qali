import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import type { StepExecutionResult } from './execution.js';

interface FailureObservation {
  testPath: string;
  title: string;
  error: string;
  evidence: string;
}

interface SelectorRepair {
  testPath: string;
  locatorMethod: 'locator' | 'getByRole' | 'getByLabel' | 'getByTestId' | 'getByText';
  from: string;
  to: string;
}

interface SuiteFingerprint {
  path: string;
  contentHash: string;
  selectorNeutralFingerprint: string;
  oracleFingerprint: string;
  selectors: Array<{ method: string; value: string }>;
}

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function jsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
  });
}

function testFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function selectorNeutralSource(source: string): string {
  return source.replace(
    /\b(locator|getByRole|getByLabel|getByTestId|getByText)\(\s*(['"`])(?:\\.|(?!\2)[\s\S])*?\2/g,
    '$1("__QALI_SELECTOR__"'
  );
}

function selectors(source: string): Array<{ method: string; value: string }> {
  return [
    ...source.matchAll(
      /\b(locator|getByRole|getByLabel|getByTestId|getByText)\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g
    )
  ].map((match) => ({ method: match[1]!, value: match[3]! }));
}

function fingerprints(workspace: string, projectRoot: string): SuiteFingerprint[] {
  return testFiles(join(workspace, projectRoot, 'tests'))
    .map((path) => {
      const source = readFileSync(path, 'utf8');
      const neutral = selectorNeutralSource(source);
      const oracle = neutral
        .split('\n')
        .filter((line) => /\bexpect\s*\(/.test(line))
        .map((line) => line.trim().replace(/\s+/g, ' '))
        .join('\n');
      return {
        path: relative(workspace, path).replaceAll('\\', '/'),
        contentHash: hash(source),
        selectorNeutralFingerprint: hash(neutral),
        oracleFingerprint: hash(oracle),
        selectors: selectors(source)
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function parseRepair(value: unknown): SelectorRepair {
  if (!value || typeof value !== 'object') throw new Error('selector repair is required');
  const repair = value as Partial<SelectorRepair>;
  if (
    typeof repair.testPath !== 'string' ||
    !/^tests\/[a-zA-Z0-9_./-]+\.spec\.ts$/.test(repair.testPath) ||
    repair.testPath.includes('..') ||
    !['locator', 'getByRole', 'getByLabel', 'getByTestId', 'getByText'].includes(
      repair.locatorMethod ?? ''
    ) ||
    typeof repair.from !== 'string' ||
    !repair.from ||
    typeof repair.to !== 'string' ||
    !repair.to ||
    repair.from.length > 240 ||
    repair.to.length > 240 ||
    /[\r\n]/.test(repair.from) ||
    /[\r\n]/.test(repair.to)
  ) {
    throw new Error('selector repair is invalid');
  }
  return repair as SelectorRepair;
}

function failureMessages(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const value = result as {
    error?: { message?: unknown };
    errors?: Array<{ message?: unknown }>;
  };
  return [value.error, ...(value.errors ?? [])]
    .map((error) => error?.message)
    .filter((message): message is string => typeof message === 'string' && Boolean(message.trim()));
}

function collectFailures(node: unknown, evidence: string, projectId: string): FailureObservation[] {
  if (!node || typeof node !== 'object') return [];
  const value = node as {
    file?: unknown;
    title?: unknown;
    specs?: unknown[];
    suites?: unknown[];
    tests?: Array<{ status?: unknown; results?: unknown[] }>;
  };
  const nested = [...(value.suites ?? []), ...(value.specs ?? [])].flatMap((child) =>
    collectFailures(child, evidence, projectId)
  );
  if (!Array.isArray(value.tests) || typeof value.file !== 'string') return nested;
  if (value.file.includes('..') || value.file.startsWith('/')) return nested;
  const testPath = value.file.startsWith(`${projectId}/`)
    ? `projects/${value.file}`
    : value.file.startsWith('projects/')
      ? value.file
      : `projects/${projectId}/${value.file}`;
  const title = typeof value.title === 'string' ? value.title : 'unknown test';
  return [
    ...nested,
    ...value.tests.flatMap((test) =>
      (test.results ?? []).flatMap((result) =>
        failureMessages(result).map((error) => ({ testPath, title, error, evidence }))
      )
    )
  ];
}

function generatedMarkdown(body: string): string {
  const normalized = `\n\n${body.trim()}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
}

export async function executeSuiteMaintenanceStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (
    command.intent !== 'maintain-suite' ||
    !['snapshot', 'diagnose', 'repair-selectors', 'validate-repair'].includes(step.id)
  ) {
    return { status: 'blocked', reason: 'unsupported deterministic suite-maintenance step' };
  }
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const projectRoot = join(workspace, command.project.root);
  const baselinePath = join(projectRoot, 'observations/evidence/suite-maintenance/baseline.json');
  if (step.id === 'snapshot') {
    const baseline = {
      version: 1,
      projectId: command.project.id,
      capturedAt: command.receivedAt,
      files: fingerprints(workspace, command.project.root)
    };
    if (baseline.files.length === 0) {
      return { status: 'failed', error: 'suite maintenance requires Playwright tests' };
    }
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    return { status: 'succeeded', outputs };
  }
  if (step.id === 'repair-selectors') {
    let repair: SelectorRepair;
    try {
      repair = parseRepair(command.parameters.selectorRepair);
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    if (!existsSync(baselinePath)) {
      return { status: 'failed', error: 'suite baseline is missing' };
    }
    const diagnosisPath = join(projectRoot, 'derived/reports/reliability-diagnosis.json');
    if (!existsSync(diagnosisPath)) {
      return { status: 'failed', error: 'reliability diagnosis is missing' };
    }
    const diagnosis = JSON.parse(readFileSync(diagnosisPath, 'utf8')) as {
      findings?: Array<{ testPath?: string; classification?: string }>;
    };
    const targetPath = `${command.project.root}/${repair.testPath}`;
    if (
      !diagnosis.findings?.some(
        (finding) => finding.testPath === targetPath && finding.classification === 'selector-drift'
      )
    ) {
      return { status: 'failed', error: 'selector repair is not backed by repeated failures' };
    }
    const target = join(projectRoot, repair.testPath);
    if (!existsSync(target))
      return { status: 'failed', error: 'selector repair target is missing' };
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      files?: SuiteFingerprint[];
    };
    const before = readFileSync(target, 'utf8');
    const baselineFile = baseline.files?.find(({ path }) => path === targetPath);
    if (!baselineFile || baselineFile.contentHash !== hash(before)) {
      return { status: 'failed', error: 'test changed after the suite baseline was captured' };
    }
    const method = repair.locatorMethod;
    const candidates = (["'", '"', '`'] as const).map((quote) => {
      const escapedFrom = repair.from.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
      return {
        token: `${method}(${quote}${escapedFrom}${quote}`,
        replacement: `${method}(${quote}${repair.to
          .replaceAll('\\', '\\\\')
          .replaceAll(quote, `\\${quote}`)}${quote}`
      };
    });
    const matches = candidates.flatMap(({ token, replacement }) => {
      const count = before.split(token).length - 1;
      return Array.from({ length: count }, () => ({ token, replacement }));
    });
    if (matches.length !== 1) {
      return { status: 'failed', error: 'selector repair must replace exactly one locator' };
    }
    const { token, replacement } = matches[0]!;
    writeFileSync(target, before.replace(token, replacement));
    return { status: 'succeeded', outputs };
  }
  if (step.id === 'validate-repair') {
    let repair: SelectorRepair;
    try {
      repair = parseRepair(command.parameters.selectorRepair);
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    if (!existsSync(baselinePath)) {
      return { status: 'failed', error: 'suite baseline is missing' };
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      files?: SuiteFingerprint[];
    };
    const before = baseline.files ?? [];
    const after = fingerprints(workspace, command.project.root);
    const beforeByPath = new Map(before.map((file) => [file.path, file]));
    const afterByPath = new Map(after.map((file) => [file.path, file]));
    const allPaths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort();
    const changedFiles = allPaths.filter(
      (path) => beforeByPath.get(path)?.contentHash !== afterByPath.get(path)?.contentHash
    );
    const targetPath = `${command.project.root}/${repair.testPath}`;
    const original = beforeByPath.get(targetPath);
    const repaired = afterByPath.get(targetPath);
    const oracleFingerprintUnchanged =
      Boolean(original && repaired) && original?.oracleFingerprint === repaired?.oracleFingerprint;
    const selectorNeutralFingerprintUnchanged =
      Boolean(original && repaired) &&
      original?.selectorNeutralFingerprint === repaired?.selectorNeutralFingerprint;
    const selectorChanges =
      original && repaired && original.selectors.length === repaired.selectors.length
        ? original.selectors.flatMap((selector, index) => {
            const replacement = repaired.selectors[index];
            return replacement?.method === selector.method && replacement.value === selector.value
              ? []
              : [{ before: selector, after: replacement }];
          })
        : [];
    const selectorChangeMatchesRequest =
      selectorChanges.length === 1 &&
      selectorChanges[0]?.before.method === repair.locatorMethod &&
      selectorChanges[0]?.before.value === repair.from &&
      selectorChanges[0]?.after?.method === repair.locatorMethod &&
      selectorChanges[0]?.after?.value === repair.to;
    const accepted =
      changedFiles.length === 1 &&
      changedFiles[0] === targetPath &&
      oracleFingerprintUnchanged &&
      selectorNeutralFingerprintUnchanged &&
      selectorChangeMatchesRequest;
    const validation = {
      version: 1,
      projectId: command.project.id,
      status: accepted ? 'accepted' : 'rejected',
      changedFiles,
      oracleFingerprintUnchanged,
      selectorNeutralFingerprintUnchanged,
      selectorChangeMatchesRequest
    };
    const validationPath = join(
      projectRoot,
      'observations/evidence/suite-maintenance/validation.json'
    );
    mkdirSync(dirname(validationPath), { recursive: true });
    writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
    return accepted
      ? { status: 'succeeded', outputs }
      : { status: 'failed', error: 'suite repair changed behavior outside one selector' };
  }
  const evidenceRoot = join(projectRoot, 'observations/evidence/test-runs');
  const failures = jsonFiles(evidenceRoot).flatMap((path) => {
    const evidence = relative(projectRoot, path).replaceAll('\\', '/');
    return collectFailures(JSON.parse(readFileSync(path, 'utf8')), evidence, command.project.id);
  });
  const grouped = new Map<string, FailureObservation[]>();
  for (const failure of failures) {
    const key = `${failure.testPath}\u0000${failure.title}`;
    grouped.set(key, [...(grouped.get(key) ?? []), failure]);
  }
  const findings = [...grouped.values()]
    .map((items) => {
      const selectorFailures = items.filter(({ error }) =>
        /\b(?:locator|getByRole|getByLabel|getByTestId|selector|waiting for element)\b/i.test(error)
      );
      const evidence = [...new Set(selectorFailures.map((item) => item.evidence))].sort();
      return {
        testPath: items[0]!.testPath,
        title: items[0]!.title,
        classification: 'selector-drift' as const,
        failedRuns: new Set(selectorFailures.map((item) => item.evidence)).size,
        evidence,
        errors: [...new Set(selectorFailures.map((item) => item.error))]
      };
    })
    .filter(({ failedRuns }) => failedRuns >= 2)
    .sort((left, right) => left.testPath.localeCompare(right.testPath));
  const diagnosis = {
    version: 1,
    projectId: command.project.id,
    generatedAt: command.receivedAt,
    minimumRepeatedFailures: 2,
    findings
  };
  for (const output of outputs) {
    const outputPath = join(workspace, output.path);
    mkdirSync(dirname(outputPath), { recursive: true });
    if (outputPath.endsWith('.json')) {
      writeFileSync(outputPath, `${JSON.stringify(diagnosis, null, 2)}\n`);
    } else if (outputPath.endsWith('.md')) {
      const body = [
        '# Reliability diagnosis',
        '',
        findings.length ? '## Repeated selector drift' : 'No repeated selector drift found.',
        ...findings.flatMap((finding) => [
          '',
          `### ${finding.title}`,
          '',
          `- Test: \`${finding.testPath}\``,
          `- Failed runs: ${finding.failedRuns}`,
          `- Evidence: ${finding.evidence.map((path) => `\`${path}\``).join(', ')}`
        ])
      ].join('\n');
      writeFileSync(outputPath, generatedMarkdown(body));
    }
  }
  return { status: 'succeeded', outputs };
}
