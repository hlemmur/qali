import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { CursorCliAgentRuntime, agentCliAvailable } from '../packages/agent-runtime/src/index.js';
import {
  NormalizedCommandSchema,
  type NormalizedCommand,
  type WorkflowEvent,
  type WorkflowStep
} from '../packages/contracts/src/index.js';
import { renderGeneratedJson } from '../packages/knowledge/src/index.js';
import {
  FileSystemOutputValidator,
  ROLE_PROFILES,
  executeWorkflow,
  loadWorkflowDirectory,
  routeCommand,
  type PolicyEnforcer,
  type PreconditionChecker,
  type StepExecutor,
  type WorkflowEventStore
} from '../packages/orchestrator/src/index.js';
import {
  SpawnPlaywrightRunner,
  parsePlaywrightJsonReport,
  type PlaywrightEvidenceSummary
} from '../packages/playwright/src/index.js';
import { renderRunReport } from '../packages/reporting/src/index.js';

const workspace = process.cwd();
const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);
const generatedMarkdown = (body: string): string => {
  const inner = body.replace(/^\n+/, '').replace(/\s+$/, '\n');
  const normalized = `\n\n${inner}`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

function writeWorkflowSlackSummary(
  command: NormalizedCommand,
  status: 'passed' | 'failed' | 'blocked',
  errors: string[] = []
): void {
  const reportDirectory = join(workspace, command.project.root, 'derived/reports');
  mkdirSync(reportDirectory, { recursive: true });
  mkdirSync(join(workspace, '.qali'), { recursive: true });
  const summary = {
    runId: command.parameters.requestId
      ? String(command.parameters.requestId)
      : `${command.intent}-run`,
    status,
    intent: command.intent,
    projectId: command.project.id,
    ...(errors.length ? { errors } : { errors: [] })
  };
  writeFileSync(join(reportDirectory, 'slack-summary.json'), renderGeneratedJson(summary));
  writeFileSync(join(workspace, '.qali/slack-summary.json'), renderGeneratedJson(summary));
}

function writePlaywrightSlackSummary(
  command: NormalizedCommand,
  summary: PlaywrightEvidenceSummary
): void {
  const reportDirectory = join(workspace, command.project.root, 'derived/reports');
  mkdirSync(reportDirectory, { recursive: true });
  mkdirSync(join(workspace, '.qali'), { recursive: true });
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const compactErrors = (summary.errors ?? [])
    .map(
      (error) =>
        error
          .replace(ansiPattern, '')
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? 'Test failed'
    )
    .map((line) => (line.length > 160 ? `${line.slice(0, 157)}…` : line))
    .slice(0, 3);
  const runSummary = {
    runId: command.parameters.requestId
      ? String(command.parameters.requestId)
      : `${command.intent}-run`,
    status: summary.failed === 0 ? 'passed' : 'failed',
    intent: command.intent,
    projectId: command.project.id,
    suiteLabel: 'smoke',
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
    evidence: (summary.evidence ?? [])
      .slice(0, 5)
      .map((path) => path.split('/').slice(-2).join('/')),
    errors: compactErrors
  };
  const report = renderRunReport(runSummary);
  writeFileSync(join(reportDirectory, 'test-run.md'), generatedMarkdown(report.markdown));
  writeFileSync(join(reportDirectory, 'test-run.json'), renderGeneratedJson(report.json));
  writeFileSync(join(reportDirectory, 'slack-summary.json'), renderGeneratedJson(report.json));
  writeFileSync(join(workspace, '.qali/slack-summary.json'), renderGeneratedJson(report.json));
}

class FileEventStore implements WorkflowEventStore {
  constructor(private readonly path: string) {}
  async append(event: WorkflowEvent) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(event)}\n`, { flag: 'a' });
  }
}

class FilePreconditions implements PreconditionChecker {
  async check(
    precondition: Parameters<PreconditionChecker['check']>[0],
    command: NormalizedCommand
  ) {
    const root = resolve(workspace, command.project.root);
    const checks: Record<string, () => boolean> = {
      'project-exists': () => existsSync(root),
      'project-context-present': () => existsSync(join(root, 'sources/project-context.md')),
      'execution-unblocked': () => {
        const questions = join(root, 'sources/questions.md');
        const decisions = join(root, 'sources/decisions.md');
        const openBlocking =
          existsSync(questions) &&
          /\|\s*Q-[^|]+\|[^|]*\|\s*open\s*\|\s*yes\s*\|/i.test(readFileSync(questions, 'utf8'));
        const override =
          existsSync(decisions) &&
          /allow (?:execution with blocking|proceed with open) questions:\s*yes/i.test(
            readFileSync(decisions, 'utf8')
          );
        return !openBlocking || override;
      },
      'approved-scenario-present': () =>
        existsSync(join(root, 'derived/scenarios/approved')) &&
        readFileNames(join(root, 'derived/scenarios/approved')).some((name) =>
          name.endsWith('.md')
        ),
      'test-suite-present': () =>
        existsSync(join(root, 'tests')) &&
        readFileNames(join(root, 'tests')).some((name) => /\.spec\.ts$/.test(name)),
      'failure-evidence-present': () => existsSync(join(root, 'observations/evidence'))
    };
    const allowed = checks[precondition]?.() ?? false;
    return allowed
      ? ({ allowed: true } as const)
      : ({ allowed: false, reason: `precondition failed: ${precondition}` } as const);
  }
}

function readFileNames(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory, { recursive: true }).map(String) : [];
}

class WorkflowPolicy implements PolicyEnforcer {
  async authorize(step: WorkflowStep, command: NormalizedCommand) {
    if (
      step.policyGates.includes('human-approval') &&
      (command.autonomy?.approvalRefs.length ?? 0) === 0
    ) {
      return {
        allowed: false as const,
        reason: 'human-approval gate requires approvalRefs'
      };
    }
    if (
      step.policyGates.includes('approved-scenario') &&
      !(
        existsSync(join(workspace, command.project.root, 'derived/scenarios/approved')) &&
        readFileNames(join(workspace, command.project.root, 'derived/scenarios/approved')).some(
          (name) => name.endsWith('.md')
        )
      )
    ) {
      return {
        allowed: false as const,
        reason: 'approved-scenario gate requires approved scenarios'
      } as const;
    }
    return { allowed: true } as const;
  }
}

class RoutedStepExecutor implements StepExecutor {
  private readonly playwright = new SpawnPlaywrightRunner();
  private readonly agent = new CursorCliAgentRuntime();
  private playwrightSummary: PlaywrightEvidenceSummary | undefined;
  private readonly skills = new Map(
    (
      JSON.parse(readFileSync(join(workspace, 'skills/catalog.json'), 'utf8')) as {
        skills: Array<{ id: string; instructions: unknown }>;
      }
    ).skills.map((skill) => [skill.id, JSON.stringify(skill.instructions)])
  );

  private shouldUseCursorCli(): boolean {
    return (
      Boolean(process.env.CURSOR_MODEL?.trim()) &&
      Boolean(process.env.CURSOR_API_KEY?.trim()) &&
      agentCliAvailable()
    );
  }

  private async deterministicAgentStep(
    step: WorkflowStep,
    command: NormalizedCommand,
    outputs: Array<{ artifact: WorkflowStep['outputs'][number]['artifact']; path: string }>
  ) {
    const projectRoot = join(workspace, command.project.root);
    if (step.id === 'analyze-failures') {
      const reportPath = join(projectRoot, 'observations/evidence/test-runs/results.json');
      if (!existsSync(reportPath) && !this.playwrightSummary) {
        return { status: 'failed' as const, error: 'Missing Playwright summary' };
      }
      const summary =
        this.playwrightSummary ??
        parsePlaywrightJsonReport(JSON.parse(readFileSync(reportPath, 'utf8')));
      this.playwrightSummary = summary;
      const analysisDirectory = join(projectRoot, 'observations/evidence/failure-analysis');
      mkdirSync(analysisDirectory, { recursive: true });
      writeFileSync(
        join(analysisDirectory, 'summary.json'),
        JSON.stringify(
          {
            mode: 'deterministic-fallback',
            failed: summary.failed,
            classification: summary.failed === 0 ? 'no-failures' : 'needs-triage',
            note: 'Cursor Agent CLI unavailable; wrote deterministic failure analysis.'
          },
          null,
          2
        )
      );
      return { status: 'succeeded' as const, outputs };
    }

    if (step.id === 'report' && command.intent === 'run-test-suite') {
      const reportPath = join(projectRoot, 'observations/evidence/test-runs/results.json');
      const summary =
        this.playwrightSummary ??
        (existsSync(reportPath)
          ? parsePlaywrightJsonReport(JSON.parse(readFileSync(reportPath, 'utf8')))
          : undefined);
      if (!summary) return { status: 'failed' as const, error: 'Missing Playwright summary' };
      const reportDirectory = join(projectRoot, 'derived/reports');
      mkdirSync(reportDirectory, { recursive: true });
      const runSummary = {
        runId: command.parameters.requestId
          ? String(command.parameters.requestId)
          : `${command.intent}-run`,
        status: summary.failed === 0 ? 'passed' : 'failed',
        intent: command.intent,
        projectId: command.project.id,
        suiteLabel: 'smoke',
        ...summary
      };
      const report = renderRunReport(runSummary);
      writeFileSync(
        join(reportDirectory, 'test-run.md'),
        generatedMarkdown(`\n${report.markdown}`)
      );
      writeFileSync(join(reportDirectory, 'test-run.json'), renderGeneratedJson(report.json));
      writeFileSync(join(reportDirectory, 'slack-summary.json'), renderGeneratedJson(report.json));
      mkdirSync(join(workspace, '.qali'), { recursive: true });
      writeFileSync(join(workspace, '.qali/slack-summary.json'), renderGeneratedJson(report.json));
      return { status: 'succeeded' as const, outputs };
    }

    for (const output of outputs) {
      const absolute = join(workspace, output.path);
      mkdirSync(dirname(absolute), { recursive: true });
      const governedSource = /(^|[/\\])sources[/\\]/.test(output.path);
      if (absolute.endsWith('.md')) {
        if (governedSource && existsSync(absolute)) {
          // Deterministic fallback must not overwrite governed sources with generated markers.
          continue;
        }
        const body = `# ${step.id}\n\nDeterministic fallback (Cursor Agent CLI not configured).\n`;
        writeFileSync(absolute, governedSource ? body : generatedMarkdown(body));
      } else if (absolute.endsWith('.json')) {
        writeFileSync(
          absolute,
          `${JSON.stringify({ mode: 'deterministic-fallback', step: step.id }, null, 2)}\n`
        );
      } else if (!existsSync(absolute)) {
        mkdirSync(absolute, { recursive: true });
        writeFileSync(
          join(absolute, 'summary.json'),
          `${JSON.stringify({ mode: 'deterministic-fallback', step: step.id }, null, 2)}\n`
        );
      }
    }
    return { status: 'succeeded' as const, outputs };
  }

  async execute(step: WorkflowStep, command: NormalizedCommand) {
    const outputs = step.outputs.map(({ artifact, path }) => ({
      artifact,
      path: expand(path, command)
    }));
    if (step.skill === 'playwright-automation' && step.role === 'executor') {
      const evidenceDir = join(workspace, command.project.root, 'observations/evidence/test-runs');
      mkdirSync(evidenceDir, { recursive: true });
      const run = await this.playwright.run({
        workspace,
        projectId: command.project.id,
        reportPath: join(evidenceDir, 'results.json')
      });
      if (existsSync(join(evidenceDir, 'results.json'))) {
        this.playwrightSummary = parsePlaywrightJsonReport(
          JSON.parse(readFileSync(join(evidenceDir, 'results.json'), 'utf8'))
        );
        writePlaywrightSlackSummary(command, this.playwrightSummary);
      }
      const jobPath = join(workspace, command.project.root, 'derived/jobs/test-run.md');
      mkdirSync(dirname(jobPath), { recursive: true });
      writeFileSync(
        jobPath,
        generatedMarkdown(
          `# Test run job\n\nStatus: ${run.status}\nEvidence: \`${join(evidenceDir, 'results.json')}\`\n`
        )
      );
      return run.status === 'passed'
        ? ({ status: 'succeeded', outputs } as const)
        : ({ status: 'failed', error: run.stderr ?? `Playwright exited ${run.exitCode}` } as const);
    }

    if (!this.shouldUseCursorCli()) {
      return this.deterministicAgentStep(step, command, outputs);
    }

    const result = await this.agent.execute({
      workspace,
      role: ROLE_PROFILES[step.role],
      step,
      skillInstructions: this.skills.get(step.skill) ?? '',
      context: JSON.stringify(command.parameters),
      timeoutMs: step.timeoutMs,
      permissions: step.requiredTools
    });
    if (result.status === 'succeeded') return { status: 'succeeded', outputs } as const;
    if (result.status === 'blocked') return { status: 'blocked', reason: result.output } as const;
    if (/ENOENT|not found/i.test(result.error)) {
      return this.deterministicAgentStep(step, command, outputs);
    }
    return { status: 'failed', error: result.error } as const;
  }
}

function commandInput(): NormalizedCommand {
  const index = process.argv.indexOf('--command');
  const raw = index >= 0 ? process.argv[index + 1] : process.env.COMMAND_JSON;
  if (!raw) throw new Error('Provide a normalized command with --command or COMMAND_JSON');
  return NormalizedCommandSchema.parse(JSON.parse(raw));
}

const command = commandInput();
mkdirSync(join(workspace, '.qali'), { recursive: true });
const agentMode =
  Boolean(process.env.CURSOR_MODEL?.trim()) &&
  Boolean(process.env.CURSOR_API_KEY?.trim()) &&
  agentCliAvailable()
    ? 'live'
    : 'deterministic-fallback';
writeFileSync(
  join(workspace, '.qali/agent-mode.json'),
  `${JSON.stringify(
    {
      mode: agentMode,
      model: process.env.CURSOR_MODEL?.trim() || null,
      agentAvailable: agentCliAvailable()
    },
    null,
    2
  )}\n`
);
const workflows = loadWorkflowDirectory(
  join(workspace, 'workflows'),
  join(workspace, 'skills/catalog.json')
);
const descriptor = routeCommand(command, workflows);
const eventPath = join(
  workspace,
  command.project.root,
  'derived/workflow-state',
  `${descriptor.id}.jsonl`
);
const result = await executeWorkflow(command, {
  loader: { load: () => descriptor },
  preconditions: new FilePreconditions(),
  policy: new WorkflowPolicy(),
  executor: new RoutedStepExecutor(),
  events: new FileEventStore(eventPath),
  outputValidator: new FileSystemOutputValidator(workspace)
});
console.log(JSON.stringify(result, null, 2));
if (result.status === 'succeeded') {
  if (command.intent !== 'run-test-suite') {
    writeWorkflowSlackSummary(command, 'passed');
  }
} else {
  const resultsPath = join(
    workspace,
    command.project.root,
    'observations/evidence/test-runs/results.json'
  );
  if (command.intent === 'run-test-suite' && existsSync(resultsPath)) {
    writePlaywrightSlackSummary(
      command,
      parsePlaywrightJsonReport(JSON.parse(readFileSync(resultsPath, 'utf8')))
    );
  } else {
    const detail = (result.events.at(-1)?.detail ?? {}) as Record<string, unknown>;
    const message =
      typeof detail.reason === 'string'
        ? detail.reason
        : typeof detail.error === 'string'
          ? detail.error
          : `Workflow ${result.status}`;
    writeWorkflowSlackSummary(command, result.status === 'blocked' ? 'blocked' : 'failed', [
      message
    ]);
  }
  process.exitCode = 1;
}
