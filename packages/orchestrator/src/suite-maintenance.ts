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

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function jsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith('.json') ? [path] : [];
  });
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
  if (command.intent !== 'maintain-suite' || step.id !== 'diagnose') {
    return { status: 'blocked', reason: 'unsupported deterministic suite-maintenance step' };
  }
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const projectRoot = join(workspace, command.project.root);
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
