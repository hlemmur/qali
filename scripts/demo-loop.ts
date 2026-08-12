import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { format as formatText } from 'prettier';
import {
  FreeFormRequestSchema,
  NormalizedCommandSchema,
  type ArtifactReference,
  type FreeFormRequest,
  type NormalizedCommand,
  type WorkflowEvent,
  type WorkflowStep
} from '../packages/contracts/src/index.js';
import {
  FileSystemOutputValidator,
  executeWorkflow,
  loadWorkflowDirectory,
  routeCommand,
  type PolicyEnforcer,
  type PreconditionChecker,
  type StepExecutor,
  type WorkflowEventStore
} from '../packages/orchestrator/src/index.js';
import {
  renderGeneratedJson,
  validateProjectDirectory,
  type ProjectValidationResult
} from '../packages/knowledge/src/index.js';
import {
  SpawnPlaywrightRunner,
  parsePlaywrightJsonReport,
  type PlaywrightEvidenceSummary,
  type PlaywrightRunner
} from '../packages/playwright/src/index.js';
import {
  renderRunReport,
  renderSlackRunDetails,
  renderSlackRunSummary,
  type RunSummary,
  type SlackBlockPayload
} from '../packages/reporting/src/index.js';

const GENERATED_PREFIX = '<!-- qali:generated owner=qali sha256=';
const FORMAT_OPTIONS = {
  singleQuote: true,
  trailingComma: 'none' as const,
  printWidth: 100
};

async function generatedMarkdown(body: string): Promise<string> {
  const normalized = `\n\n${await formatText(body, { ...FORMAT_OPTIONS, parser: 'markdown' })}`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `${GENERATED_PREFIX}${hash} -->${normalized}`;
}

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

export interface DemoRequestClassifier {
  classify(request: FreeFormRequest): Promise<NormalizedCommand> | NormalizedCommand;
}

export class MockStructuredClassifier implements DemoRequestClassifier {
  classify(request: FreeFormRequest): NormalizedCommand {
    const intent = /^explore\b/i.test(request.text)
      ? 'explore-project'
      : /^generate\b/i.test(request.text)
        ? 'generate-test-suite'
        : 'run-test-suite';
    return NormalizedCommandSchema.parse({
      intent,
      project: { id: '_demo', root: 'projects/_demo', environment: 'mock' },
      requestedBy: request.requestedBy,
      receivedAt: request.receivedAt,
      parameters: {
        focus: /dashboard/i.test(request.text) ? 'login-and-dashboard' : 'all',
        suite: /dashboard/i.test(request.text) ? 'dashboard' : 'all',
        mockMode: true
      },
      autonomy: {
        mode: 'autonomous',
        approvalRefs: [],
        allowProceedWithOpenQuestions: false
      },
      slack: request.slack
    });
  }
}

class JsonlEventStore implements WorkflowEventStore {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }

  async append(event: WorkflowEvent): Promise<void> {
    writeFileSync(this.path, `${JSON.stringify(event)}\n`, { flag: 'a' });
  }
}

class DemoPreconditions implements PreconditionChecker {
  constructor(private readonly workspace: string) {}

  async check(
    precondition: Parameters<PreconditionChecker['check']>[0],
    command: NormalizedCommand
  ) {
    const root = join(this.workspace, command.project.root);
    const questionsPath = join(root, 'sources/questions.md');
    const decisionsPath = join(root, 'sources/decisions.md');
    const openBlocking =
      existsSync(questionsPath) &&
      /\|\s*Q-[^|]+\|[^|]*\|\s*open\s*\|\s*yes\s*\|/i.test(readFileSync(questionsPath, 'utf8'));
    const blockingOverride =
      existsSync(decisionsPath) &&
      /allow execution with blocking questions:\s*yes/i.test(readFileSync(decisionsPath, 'utf8'));
    const approvedDirectory = join(root, 'derived/scenarios/approved');
    const checks: Record<string, boolean> = {
      'project-exists': existsSync(root),
      'project-context-present': existsSync(join(root, 'sources/project-context.md')),
      'execution-unblocked': !openBlocking || blockingOverride,
      'approved-scenario-present':
        existsSync(approvedDirectory) &&
        readdirSync(approvedDirectory).some((path) => path.endsWith('.md')),
      'test-suite-present':
        existsSync(join(root, 'tests')) &&
        readdirSync(join(root, 'tests'), { recursive: true }).some((path) =>
          String(path).endsWith('.spec.ts')
        ),
      'failure-evidence-present': existsSync(join(root, 'observations/evidence'))
    };
    return checks[precondition]
      ? ({ allowed: true } as const)
      : ({ allowed: false, reason: `precondition failed: ${precondition}` } as const);
  }
}

export class DemoPolicy implements PolicyEnforcer {
  async authorize(step: WorkflowStep, command: NormalizedCommand) {
    if (step.mutations.includes('weaken-assertion')) {
      return { allowed: false, reason: 'semantic safety prohibits weakening assertions' } as const;
    }
    if (
      step.policyGates.includes('human-approval') &&
      (command.autonomy?.approvalRefs.length ?? 0) === 0
    ) {
      return { allowed: false, reason: 'explicit human approval is required' } as const;
    }
    return { allowed: true } as const;
  }
}

function materializedOutputs(step: WorkflowStep, command: NormalizedCommand): ArtifactReference[] {
  return step.outputs.map(({ artifact, path }) => ({ artifact, path: expand(path, command) }));
}

class MockModeStepExecutor implements StepExecutor {
  summary?: PlaywrightEvidenceSummary;

  constructor(
    private readonly workspace: string,
    private readonly playwright: PlaywrightRunner,
    private readonly targetBaseUrl: string
  ) {}

  async execute(step: WorkflowStep, command: NormalizedCommand) {
    const outputs = materializedOutputs(step, command);
    const projectRoot = join(this.workspace, command.project.root);

    if (command.intent === 'explore-project' && step.id === 'charter') {
      const explorationPath = join(projectRoot, 'observations/exploration.md');
      mkdirSync(dirname(explorationPath), { recursive: true });
      writeFileSync(
        explorationPath,
        await formatText(
          '# Exploration Charter\n\nFocus: login and dashboard behavior.\n\nStatus: ready.\n',
          { ...FORMAT_OPTIONS, parser: 'markdown' }
        )
      );
      return { status: 'succeeded', outputs } as const;
    }

    if (command.intent === 'explore-project' && step.id === 'explore') {
      const evidenceDirectory = join(projectRoot, 'observations/evidence/exploration');
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        join(evidenceDirectory, 'login-dashboard.json'),
        JSON.stringify(
          {
            mode: 'mock',
            status: 'observed',
            observations: [
              'Valid seeded credentials reveal the dashboard.',
              'Invalid credentials produce an accessible alert.'
            ]
          },
          null,
          2
        )
      );
      const explorationPath = join(projectRoot, 'observations/exploration.md');
      writeFileSync(
        explorationPath,
        await formatText(
          '# Exploration Log\n\n' +
            '| ID | Observation | Status | Evidence | Observed at | Session |\n' +
            '| --- | --- | --- | --- | --- | --- |\n' +
            '| OBS-001 | Seeded credentials reach the dashboard. | observed | `observations/evidence/exploration/login-dashboard.json` | 2026-08-10 | mock-exploration |\n' +
            '| OBS-002 | Invalid credentials produce an accessible alert. | observed | `observations/evidence/exploration/login-dashboard.json` | 2026-08-10 | mock-exploration |\n',
          { ...FORMAT_OPTIONS, parser: 'markdown' }
        )
      );
      return { status: 'succeeded', outputs } as const;
    }

    if (command.intent === 'explore-project' && step.id === 'report') {
      const reportPath = join(projectRoot, 'derived/reports/exploration.md');
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(
        reportPath,
        await generatedMarkdown(
          '\n# Exploration report\n\nStatus: complete\n\nObserved login and dashboard behavior with deterministic Mock Mode evidence.\n'
        )
      );
      return { status: 'succeeded', outputs } as const;
    }

    if (command.intent === 'generate-test-suite' && step.id === 'design-coverage') {
      const coveragePath = join(projectRoot, 'derived/scenarios/coverage-map.md');
      mkdirSync(dirname(coveragePath), { recursive: true });
      writeFileSync(
        coveragePath,
        await generatedMarkdown(
          '\n# Dashboard coverage map\n\n| Scenario | Source | Test |\n| --- | --- | --- |\n| Seeded user reaches dashboard | `derived/scenarios/approved/demo-smoke.md` | `DEMO-GEN-001` |\n'
        )
      );
      return { status: 'succeeded', outputs } as const;
    }

    if (command.intent === 'generate-test-suite' && step.id === 'generate-tests') {
      const generatedTest = join(projectRoot, 'tests/generated/dashboard.generated.spec.ts');
      mkdirSync(dirname(generatedTest), { recursive: true });
      writeFileSync(
        generatedTest,
        await formatText(
          "import { expect, test } from '@playwright/test';\n\n" +
            "test('DEMO-GEN-001 generated dashboard journey', async ({ page }) => {\n" +
            "  await page.goto('/');\n" +
            "  await page.getByLabel('Email').fill('alex@example.test');\n" +
            "  await page.getByLabel('Password').fill('demo123');\n" +
            "  await page.getByRole('button', { name: 'Sign in' }).click();\n" +
            "  await expect(page.getByRole('heading', { name: 'Good morning, Alex Morgan' })).toBeVisible();\n" +
            "  await expect(page.getByTestId('balance')).toHaveText('$12,480.50');\n" +
            '});\n',
          { ...FORMAT_OPTIONS, parser: 'typescript' }
        )
      );
      const evidenceDirectory = join(projectRoot, 'observations/evidence/test-generation');
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        join(evidenceDirectory, 'traceability.json'),
        JSON.stringify(
          {
            mode: 'mock',
            scenario: 'derived/scenarios/approved/demo-smoke.md',
            test: 'tests/generated/dashboard.generated.spec.ts',
            testId: 'DEMO-GEN-001'
          },
          null,
          2
        )
      );
      return { status: 'succeeded', outputs } as const;
    }

    if (step.id === 'execute') {
      const evidenceDirectory = join(projectRoot, 'observations/evidence/test-runs');
      const reportPath = join(evidenceDirectory, 'results.json');
      mkdirSync(evidenceDirectory, { recursive: true });
      rmSync(reportPath, { force: true });
      const run = await this.playwright.run({
        workspace: this.workspace,
        projectId: command.project.id,
        targetBaseUrl: this.targetBaseUrl,
        reportPath,
        ...(typeof command.parameters.suite === 'string' &&
        command.parameters.suite !== 'all' &&
        command.parameters.suite !== 'dashboard'
          ? { grep: command.parameters.suite }
          : {})
      });
      if (!existsSync(reportPath)) {
        return {
          status: 'failed' as const,
          error: 'Playwright did not materialize its JSON report'
        };
      }
      this.summary = parsePlaywrightJsonReport(JSON.parse(readFileSync(reportPath, 'utf8')));
      const jobPath = join(projectRoot, 'derived/jobs/test-run.md');
      mkdirSync(dirname(jobPath), { recursive: true });
      writeFileSync(
        jobPath,
        await generatedMarkdown(
          `\n# Test run job\n\nMode: Mock Mode\nStatus: ${run.status}\nReport: \`${command.project.root}/observations/evidence/test-runs/results.json\`\n`
        )
      );
      return run.status === 'passed'
        ? ({ status: 'succeeded', outputs } as const)
        : ({ status: 'failed', error: run.stderr ?? `Playwright exited ${run.exitCode}` } as const);
    }

    if (step.id === 'analyze-failures') {
      if (!this.summary) return { status: 'failed' as const, error: 'Missing Playwright summary' };
      const analysisDirectory = join(projectRoot, 'observations/evidence/failure-analysis');
      mkdirSync(analysisDirectory, { recursive: true });
      writeFileSync(
        join(analysisDirectory, 'summary.json'),
        JSON.stringify(
          {
            mode: 'mock',
            failed: this.summary.failed,
            classification: this.summary.failed === 0 ? 'no-failures' : 'deterministic-demo-failure'
          },
          null,
          2
        )
      );
      return { status: 'succeeded', outputs } as const;
    }

    if (step.id === 'report') {
      if (!this.summary) return { status: 'failed' as const, error: 'Missing Playwright summary' };
      const reportDirectory = join(projectRoot, 'derived/reports');
      mkdirSync(reportDirectory, { recursive: true });
      const summary: RunSummary = {
        runId: 'run-test-suite-demo-run',
        status: this.summary.failed === 0 ? 'passed' : 'failed',
        ...this.summary
      };
      const report = renderRunReport(summary);
      writeFileSync(
        join(reportDirectory, 'test-run.md'),
        await generatedMarkdown(`\n${report.markdown}`)
      );
      writeFileSync(join(reportDirectory, 'test-run.json'), renderGeneratedJson(report.json));
      return { status: 'succeeded', outputs } as const;
    }

    return { status: 'failed', error: `Unsupported Mock Mode step: ${step.id}` } as const;
  }
}

export interface DemoLoopOptions {
  workspace?: string;
  repositoryRoot?: string;
  requests?: readonly string[];
  playwright?: PlaywrightRunner;
  classifier?: DemoRequestClassifier;
  now?: () => Date;
}

export interface DemoSequenceResult {
  request: string;
  command: NormalizedCommand;
  workflow: Awaited<ReturnType<typeof executeWorkflow>>;
}

export interface DemoLoopResult {
  sequence: DemoSequenceResult[];
  report: PlaywrightEvidenceSummary;
  projectValidation: ProjectValidationResult;
  slack: SlackBlockPayload;
  slackDetails: SlackBlockPayload;
  paths: {
    events: string[];
    explorationLog: string;
    explorationEvidence: string;
    coverageMap: string;
    generatedTest: string;
    generationEvidence: string;
    evidence: string;
    job: string;
    markdownReport: string;
    jsonReport: string;
    slackPayload: string;
    slackDetailsPayload: string;
  };
}

export async function runDemoLoop(options: DemoLoopOptions = {}): Promise<DemoLoopResult> {
  const workspace = resolve(options.workspace ?? process.cwd());
  const repositoryRoot = resolve(options.repositoryRoot ?? workspace);
  const now = options.now ?? (() => new Date());
  const requests = options.requests ?? [
    'Explore login and dashboard',
    'Generate important dashboard tests',
    'Run the dashboard suite'
  ];
  const classifier = options.classifier ?? new MockStructuredClassifier();
  const workflows = loadWorkflowDirectory(
    join(repositoryRoot, 'workflows'),
    join(repositoryRoot, 'harness/profiles.json')
  );
  const executor = new MockModeStepExecutor(
    workspace,
    options.playwright ?? new SpawnPlaywrightRunner(),
    process.env.QALI_TARGET_BASE_URL ?? 'http://127.0.0.1:4173'
  );
  const sequence: DemoSequenceResult[] = [];
  const eventPaths: string[] = [];
  for (const [requestIndex, text] of requests.entries()) {
    const request = FreeFormRequestSchema.parse({
      text,
      requestedBy: 'U-MOCK',
      receivedAt: now().toISOString(),
      slack: {
        teamId: 'T-MOCK',
        channelId: 'C-MOCK',
        threadTs: '1700000000.001',
        requestTs: '1700000000.001'
      }
    });
    const command = NormalizedCommandSchema.parse(await classifier.classify(request));
    const descriptor = routeCommand(command, workflows);
    const eventPath = join(
      workspace,
      command.project.root,
      'derived/workflow-state',
      `${descriptor.id}.jsonl`
    );
    let idSequence = 0;
    const workflow = await executeWorkflow(command, {
      loader: { load: () => descriptor },
      preconditions: new DemoPreconditions(workspace),
      policy: new DemoPolicy(),
      executor,
      events: new JsonlEventStore(eventPath),
      outputValidator: new FileSystemOutputValidator(workspace),
      now,
      id: () =>
        idSequence++ === 0
          ? `${descriptor.id}-demo-run`
          : `${descriptor.id}-demo-event-${requestIndex + 1}-${idSequence}`
    });
    sequence.push({ request: text, command, workflow });
    eventPaths.push(eventPath);
    if (workflow.status !== 'succeeded') break;
  }
  if (!executor.summary) throw new Error('Demo loop completed without Playwright results');

  const projectRoot = join(workspace, 'projects/_demo');
  const finalWorkflow = sequence.at(-1)?.workflow;
  if (!finalWorkflow) throw new Error('Demo sequence produced no workflow result');
  const reportDirectory = join(projectRoot, 'derived/reports');
  const runSummary = {
    runId: finalWorkflow.runId,
    status: finalWorkflow.status,
    ...executor.summary
  };
  const slack = renderSlackRunSummary(runSummary, {
    detailsUrl: 'https://example.invalid/qali/demo/details',
    rerunValue: finalWorkflow.runId,
    expandValue: finalWorkflow.runId,
    triageValue: finalWorkflow.runId
  });
  const slackDetails = renderSlackRunDetails(runSummary);
  const slackPayload = join(reportDirectory, 'slack-summary.json');
  const slackDetailsPayload = join(reportDirectory, 'slack-details.json');
  writeFileSync(slackPayload, renderGeneratedJson(slack));
  writeFileSync(slackDetailsPayload, renderGeneratedJson(slackDetails));
  const projectValidation = validateProjectDirectory(projectRoot);
  if (!projectValidation.valid) {
    throw new Error(
      `Generated demo project is invalid: ${projectValidation.issues
        .map(({ message }) => message)
        .join('; ')}`
    );
  }
  return {
    sequence,
    report: executor.summary,
    projectValidation,
    slack,
    slackDetails,
    paths: {
      events: eventPaths,
      explorationLog: join(projectRoot, 'observations/exploration.md'),
      explorationEvidence: join(projectRoot, 'observations/evidence/exploration'),
      coverageMap: join(projectRoot, 'derived/scenarios/coverage-map.md'),
      generatedTest: join(projectRoot, 'tests/generated/dashboard.generated.spec.ts'),
      generationEvidence: join(projectRoot, 'observations/evidence/test-generation'),
      evidence: join(projectRoot, 'observations/evidence/test-runs'),
      job: join(projectRoot, 'derived/jobs/test-run.md'),
      markdownReport: join(reportDirectory, 'test-run.md'),
      jsonReport: join(reportDirectory, 'test-run.json'),
      slackPayload,
      slackDetailsPayload
    }
  };
}

async function main(): Promise<void> {
  console.log('[MOCK MODE] Running Explore → Generate → Playwright demo sequence');
  const result = await runDemoLoop();
  for (const item of result.sequence) {
    console.log(
      `[MOCK MODE] ${item.request} → ${item.workflow.workflowId}: ${item.workflow.status}`
    );
  }
  console.log(
    `[MOCK MODE] ${result.report.passed} passed, ${result.report.failed} failed, ${result.report.skipped} skipped`
  );
  console.log('[MOCK MODE] Project validation: passed');
  console.log(`[MOCK MODE] Report: ${result.paths.markdownReport}`);
  if (result.sequence.some(({ workflow }) => workflow.status !== 'succeeded')) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
