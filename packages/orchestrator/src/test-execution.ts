import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import {
  resolvePlaywrightSuite,
  summarizePlaywrightRun,
  type PlaywrightRunEvidence,
  type PlaywrightRunner
} from '../../playwright/src/index.js';
import type { StepExecutionResult } from './execution.js';

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

const generatedMarkdown = (body: string): string => {
  const inner = body.replace(/^\n+/, '').replace(/\s+$/, '\n');
  const normalized = `\n\n${inner}`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

export interface TestRunStepOutcome {
  result: StepExecutionResult;
  summary?: PlaywrightRunEvidence;
}

export async function executeTestRunStep(input: {
  workspace: string;
  step: WorkflowStep;
  command: NormalizedCommand;
  runner: PlaywrightRunner;
  targetBaseUrl: string;
  signal: AbortSignal;
  webServer?: { command: string; url: string };
}): Promise<TestRunStepOutcome> {
  const { workspace, step, command, runner, targetBaseUrl, signal, webServer } = input;
  if (command.intent !== 'run-test-suite' || step.id !== 'execute' || step.role !== 'executor') {
    return {
      result: { status: 'blocked', reason: 'invalid deterministic test execution step' }
    };
  }

  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const evidenceDirectory = join(
    workspace,
    command.project.root,
    'observations/evidence/test-runs'
  );
  const reportPath = join(evidenceDirectory, 'results.json');
  mkdirSync(evidenceDirectory, { recursive: true });
  const suite = resolvePlaywrightSuite(command.parameters.suite);
  const run = await runner.run({
    workspace,
    projectId: command.project.id,
    targetBaseUrl,
    reportPath,
    ...(suite.grep ? { grep: suite.grep } : {}),
    signal,
    ...(webServer ? { webServer } : {})
  });

  let summary: PlaywrightRunEvidence | undefined;
  if (existsSync(reportPath)) {
    summary = summarizePlaywrightRun(JSON.parse(readFileSync(reportPath, 'utf8')), run);
    if (!summary.evidence.includes(reportPath)) summary.evidence.unshift(reportPath);
  }

  const jobPath = join(workspace, command.project.root, 'derived/jobs/test-run.md');
  mkdirSync(dirname(jobPath), { recursive: true });
  writeFileSync(
    jobPath,
    generatedMarkdown(
      `# Test run job\n\nStatus: ${summary?.status ?? run.status}\nEvidence: \`${reportPath}\`\n`
    )
  );

  if (!summary) {
    return {
      result: {
        status: 'failed',
        error: run.stderr ?? 'Playwright did not produce a JSON report'
      }
    };
  }
  return summary.status === 'passed'
    ? { result: { status: 'succeeded', outputs }, summary }
    : {
        result: {
          status: 'failed',
          error: run.stderr ?? `Playwright exited ${run.exitCode}`
        },
        summary
      };
}
