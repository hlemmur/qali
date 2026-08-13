import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { parsePlaywrightJsonReport } from '../../playwright/src/index.js';
import type { StepExecutionResult } from './execution.js';

interface SourceFile {
  path: string;
  contents: string;
}

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function files(root: string, directory: string, suffix: string): SourceFile[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) return files(root, relative(root, path), suffix);
    return entry.name.endsWith(suffix)
      ? [{ path: relative(root, path).replaceAll('\\', '/'), contents: readFileSync(path, 'utf8') }]
      : [];
  });
}

function source(root: string, path: string): SourceFile | undefined {
  const absolute = join(root, path);
  return existsSync(absolute) ? { path, contents: readFileSync(absolute, 'utf8') } : undefined;
}

function headingIds(markdown: string, prefix: string): string[] {
  return [...markdown.matchAll(new RegExp(`^##\\s+(${prefix}[A-Z0-9-]*)(?::|\\s|$)`, 'gim'))].map(
    (match) => match[1]!
  );
}

function tableStatusCount(markdown: string, status: string): number {
  return markdown
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .filter((line) => line.split('|').some((cell) => cell.trim().toLowerCase() === status)).length;
}

function generatedJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function executeQualityPulseStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (command.intent !== 'quality-pulse' || step.id !== 'aggregate') {
    return { status: 'blocked', reason: 'unsupported deterministic quality-pulse step' };
  }
  const projectRoot = join(workspace, command.project.root);
  const runFiles = files(projectRoot, 'observations/evidence/test-runs', '.json');
  const runSummaries = runFiles.map(({ contents }) =>
    parsePlaywrightJsonReport(JSON.parse(contents))
  );
  const riskFiles = files(projectRoot, 'sources/reference', '.md').filter(({ path }) =>
    /(?:^|\/)risks?\.md$/i.test(path)
  );
  const scenarioFiles = files(projectRoot, 'derived/scenarios/approved', '.md');
  const testFiles = files(projectRoot, 'tests', '.spec.ts');
  const questions = source(projectRoot, 'sources/questions.md');
  const decisions = source(projectRoot, 'sources/decisions.md');
  const risks = riskFiles.flatMap(({ contents }) => {
    const headings = [...contents.matchAll(/^##\s+(RISK-[A-Z0-9-]+)(?::|\s|$)/gim)];
    return headings.map((heading, index) => {
      const body = contents.slice(
        heading.index + heading[0].length,
        headings[index + 1]?.index ?? contents.length
      );
      return { id: heading[1]!, open: /(?:^|\n)\s*-\s*Status:\s*open\b/im.test(body) };
    });
  });
  const approvedIds = [
    ...new Set(scenarioFiles.flatMap(({ contents }) => headingIds(contents, '[A-Z]+-')))
  ];
  const automatedIds = approvedIds.filter((id) =>
    testFiles.some(({ contents }) => contents.includes(id))
  );
  const sources = [
    ...runFiles,
    ...riskFiles,
    ...scenarioFiles,
    ...testFiles,
    ...(questions ? [questions] : []),
    ...(decisions ? [decisions] : [])
  ]
    .map(({ path }) => path)
    .sort();
  const facts = {
    version: 1,
    projectId: command.project.id,
    generatedAt: command.receivedAt,
    factsHash: createHash('sha256')
      .update(
        [
          ...runFiles,
          ...riskFiles,
          ...scenarioFiles,
          ...testFiles,
          ...(questions ? [questions] : []),
          ...(decisions ? [decisions] : [])
        ]
          .sort((left, right) => left.path.localeCompare(right.path))
          .map(({ path, contents }) => `${path}\u0000${contents}`)
          .join('\u0000')
      )
      .digest('hex'),
    runs: {
      count: runSummaries.length,
      total: runSummaries.reduce((total, run) => total + run.total, 0),
      passed: runSummaries.reduce((total, run) => total + run.passed, 0),
      failed: runSummaries.reduce((total, run) => total + run.failed, 0),
      skipped: runSummaries.reduce((total, run) => total + run.skipped, 0),
      durationMs: runSummaries.reduce((total, run) => total + run.durationMs, 0)
    },
    risks: { total: risks.length, open: risks.filter(({ open }) => open).length },
    failures: { count: runSummaries.reduce((total, run) => total + run.failed, 0) },
    coverage: {
      approvedScenarios: approvedIds.length,
      automatedScenarios: automatedIds.length,
      percent: approvedIds.length ? Math.round((automatedIds.length / approvedIds.length) * 100) : 0
    },
    openDecisions: {
      questions: questions ? tableStatusCount(questions.contents, 'open') : 0,
      proposedDecisions: decisions ? tableStatusCount(decisions.contents, 'proposed') : 0,
      total:
        (questions ? tableStatusCount(questions.contents, 'open') : 0) +
        (decisions ? tableStatusCount(decisions.contents, 'proposed') : 0)
    },
    sources
  };
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  for (const output of outputs) {
    const path = join(workspace, output.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, generatedJson(facts));
  }
  return { status: 'succeeded', outputs };
}
