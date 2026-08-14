import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  QualitySnapshotSchema,
  type NormalizedCommand,
  type QualitySnapshot,
  type WorkflowStep
} from '../../contracts/src/index.js';
import type { StepExecutionResult } from './execution.js';
import { effectiveScheduleJobs, loadProjectSchedule } from './project-schedule.js';

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function listFiles(root: string, directory: string, suffix: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) return listFiles(root, relative(root, path), suffix);
    return entry.name.endsWith(suffix) ? [relative(root, path).replaceAll('\\', '/')] : [];
  });
}

function read(root: string, path: string): string | undefined {
  const absolute = join(root, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
}

function headings(markdown: string, prefix: string): string[] {
  return [...markdown.matchAll(new RegExp(`^##\\s+(${prefix}[^\\n]+)$`, 'gim'))].map((match) =>
    match[1]!.replace(/\s+/g, ' ').trim()
  );
}

function openQuestionRows(markdown: string): string[] {
  const lines = markdown.split('\n').filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const headers = lines[0]!.split('|').map((cell) => cell.trim().toLowerCase());
  const questionIndex = headers.findIndex((cell) => cell === 'question');
  const statusIndex = headers.findIndex((cell) => cell === 'status');
  if (questionIndex < 0 || statusIndex < 0) return [];
  return lines.slice(2).flatMap((line) => {
    const cells = line.split('|').map((cell) => cell.trim());
    const question = cells[questionIndex];
    return question && cells[statusIndex]?.toLowerCase() === 'open' ? [question] : [];
  });
}

function knownIssueRows(markdown: string): string[] {
  const lines = markdown.split('\n').filter((line) => line.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const headers = lines[0]!.split('|').map((cell) => cell.trim().toLowerCase());
  const summaryIndex = headers.findIndex((cell) => cell === 'summary');
  const statusIndex = headers.findIndex((cell) => cell === 'status');
  if (summaryIndex < 0) return [];
  return lines.slice(2).flatMap((line) => {
    const cells = line.split('|').map((cell) => cell.trim());
    const summary = cells[summaryIndex];
    const status = cells[statusIndex]?.toLowerCase() ?? '';
    if (
      !summary ||
      /no known issues/i.test(summary) ||
      status === 'unknown' ||
      status === 'closed'
    ) {
      return [];
    }
    return [summary];
  });
}

export function buildQualitySnapshot(
  workspace: string,
  command: NormalizedCommand,
  now = new Date()
): QualitySnapshot {
  const projectRoot = join(workspace, command.project.root);
  const testRunRaw = read(projectRoot, 'derived/reports/test-run.json');
  let lastRun: QualitySnapshot['lastRun'];
  if (testRunRaw) {
    try {
      const report = JSON.parse(testRunRaw) as {
        status?: unknown;
        intent?: unknown;
        total?: unknown;
        passed?: unknown;
        failed?: unknown;
        skipped?: unknown;
      };
      if (typeof report.status === 'string') {
        lastRun = {
          intent: typeof report.intent === 'string' ? report.intent : 'run-test-suite',
          finishedAt: now.toISOString(),
          status: report.status,
          ...(typeof report.total === 'number' &&
          typeof report.passed === 'number' &&
          typeof report.failed === 'number' &&
          typeof report.skipped === 'number'
            ? {
                counts: {
                  total: report.total,
                  passed: report.passed,
                  failed: report.failed,
                  skipped: report.skipped
                }
              }
            : {})
        };
      }
    } catch {
      lastRun = undefined;
    }
  }
  const approved = listFiles(projectRoot, 'derived/scenarios/approved', '.md');
  const tests = listFiles(projectRoot, 'tests', '.spec.ts');
  const percent =
    approved.length === 0
      ? 0
      : Math.round((Math.min(tests.length, approved.length) / approved.length) * 100);
  const journeys = headings(read(projectRoot, 'sources/reference/journeys.md') ?? '', 'JRN-');
  const expectedResults = headings(
    read(projectRoot, 'sources/reference/requirements.md') ?? '',
    'REQ-'
  );
  const openQuestions = openQuestionRows(read(projectRoot, 'sources/questions.md') ?? '');
  const knownIssues = knownIssueRows(read(projectRoot, 'observations/known-issues.md') ?? '');
  let schedules: QualitySnapshot['schedules'] = [];
  try {
    const schedule = loadProjectSchedule(projectRoot);
    schedules = effectiveScheduleJobs(schedule).map((entry) => ({
      workflowId: entry.workflowId,
      cron: entry.cron,
      enabled: entry.enabled
    }));
  } catch {
    try {
      const registry = JSON.parse(
        readFileSync(join(workspace, 'projects/registry.json'), 'utf8')
      ) as {
        projects?: Array<{
          id?: string;
          schedules?: Array<{ workflowId?: string; cron?: string; enabled?: boolean }>;
        }>;
      };
      const project = registry.projects?.find((entry) => entry.id === command.project.id);
      schedules = (project?.schedules ?? []).flatMap((entry) =>
        typeof entry.workflowId === 'string' && typeof entry.cron === 'string'
          ? [{ workflowId: entry.workflowId, cron: entry.cron, enabled: entry.enabled !== false }]
          : []
      );
    } catch {
      /* schedule file and registry are optional for snapshot answers */
    }
  }
  return QualitySnapshotSchema.parse({
    version: 1,
    projectId: command.project.id,
    updatedAt: now.toISOString(),
    ...(lastRun ? { lastRun } : {}),
    coverage: {
      approvedScenarios: approved.length,
      automatedTests: tests.length,
      percent
    },
    journeys,
    openQuestions,
    knownIssues,
    expectedResults,
    schedules
  });
}

export async function executeQueryProjectStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (command.intent !== 'query-project' || step.id !== 'snapshot') {
    return { status: 'blocked', reason: 'unsupported deterministic query-project step' };
  }
  const snapshot = buildQualitySnapshot(workspace, command);
  const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  for (const output of outputs) {
    const path = join(workspace, output.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, payload);
  }
  mkdirSync(join(workspace, '.qali'), { recursive: true });
  writeFileSync(join(workspace, '.qali/quality-snapshot.json'), payload);
  return { status: 'succeeded', outputs };
}
