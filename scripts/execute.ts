import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { CursorCliAgentRuntime } from '../packages/agent-runtime/src/index.js';
import {
  NormalizedCommandSchema,
  type NormalizedCommand,
  type WorkflowEvent,
  type WorkflowStep
} from '../packages/contracts/src/index.js';
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
import { SpawnPlaywrightRunner } from '../packages/playwright/src/index.js';

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
  private readonly skills = new Map(
    (
      JSON.parse(readFileSync(join(workspace, 'skills/catalog.json'), 'utf8')) as {
        skills: Array<{ id: string; instructions: unknown }>;
      }
    ).skills.map((skill) => [skill.id, JSON.stringify(skill.instructions)])
  );

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
