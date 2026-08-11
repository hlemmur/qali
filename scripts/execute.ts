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
  const normalized = body.startsWith('\n') ? body : `\n${body}`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

class FileEventStore implements WorkflowEventStore {
  constructor(private readonly path: string) {}
  async append(event: WorkflowEvent): Promise<void> {
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
        allowed: false,
        reason: `step ${step.id} requires a human approval reference`
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
    return Boolean(process.env.CURSOR_MODEL?.trim()) && agentCliAvailable();
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

    if (step.id === 'report') {
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
        ...summary
      };
      const report = renderRunReport(runSummary);
      writeFileSync(
        join(reportDirectory, 'test-run.md'),
        generatedMarkdown(`\n${report.markdown}`)
      );
      writeFileSync(join(reportDirectory, 'test-run.json'), renderGeneratedJson(report.json));
      return { status: 'succeeded' as const, outputs };
    }

    for (const output of outputs) {
      const absolute = join(workspace, output.path);
      mkdirSync(dirname(absolute), { recursive: true });
      if (absolute.endsWith('.md')) {
        writeFileSync(
          absolute,
          generatedMarkdown(
            `\n# ${step.id}\n\nDeterministic fallback (Cursor Agent CLI not configured).\n`
          )
        );
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
      }
      const jobPath = join(workspace, command.project.root, 'derived/jobs/test-run.md');
      mkdirSync(dirname(jobPath), { recursive: true });
      writeFileSync(
        jobPath,
        generatedMarkdown(
          `\n# Test run job\n\nStatus: ${run.status}\nEvidence: \`${join(evidenceDir, 'results.json')}\`\n`
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
if (result.status !== 'succeeded') process.exitCode = 1;
