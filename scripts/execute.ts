import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { CursorCliAgentRuntime, agentCliAvailable } from '../packages/agent-runtime/src/index.js';
import { RestrictedBrowserFacade } from '@qali/browser-facade';
import { PlaywrightBrowserDriver } from '@qali/browser-facade/playwright-driver';
import { resolveBrowserServiceConfig } from '@qali/browser-facade/service-config';
import {
  harnessExecutionKind,
  loadHarnessProfiles,
  selectHarnessProfile
} from '../packages/agent-runtime/src/harness-profiles.js';
import { loadRuntimeSkillAssets } from '../packages/agent-runtime/src/skill-assets.js';
import { computeRuntimeQualificationIdentity } from '../packages/agent-runtime/src/qualification-identity.js';
import {
  loadQualificationRegistry,
  qualificationExecutionMode,
  selectQualifiedCombination,
  type QualificationExecutionMode
} from '../packages/agent-runtime/src/qualification.js';
import {
  NormalizedCommandSchema,
  ProjectExecutionProfileSchema,
  type NormalizedCommand,
  type ProjectExecutionProfile,
  type WorkflowEvent,
  type WorkflowStep
} from '../packages/contracts/src/index.js';
import { resolveExecutionTarget } from '../packages/project-config/src/index.js';
import { renderGeneratedJson } from '../packages/knowledge/src/index.js';
import {
  FileSystemOutputValidator,
  ROLE_PROFILES,
  executeExplorationStep,
  executeOnboardingMockStep,
  executeTestRunStep,
  executeTestGenerationStep,
  executeWorkflow,
  loadWorkflowDirectory,
  routeCommand,
  type PolicyEnforcer,
  type PreconditionChecker,
  type GeneratedTestValidator,
  type StepExecutor,
  type WorkflowEventStore
} from '../packages/orchestrator/src/index.js';
import {
  SpawnPlaywrightRunner,
  parsePlaywrightJsonReport,
  resolvePlaywrightSuite,
  type PlaywrightEvidenceSummary
} from '../packages/playwright/src/index.js';
import { renderRunReport } from '../packages/reporting/src/index.js';
import { selectAgentExecutionRoute } from './execute-routing.js';
import { shouldWriteFallbackPlaywrightSummary } from './execute-reporting.js';

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
  summary: PlaywrightEvidenceSummary & { status?: 'passed' | 'failed' }
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
    status: summary.status ?? (summary.failed === 0 ? 'passed' : 'failed'),
    intent: command.intent,
    projectId: command.project.id,
    suiteLabel: resolvePlaywrightSuite(command.parameters.suite).label,
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
  private playwrightSummary:
    (PlaywrightEvidenceSummary & { status?: 'passed' | 'failed' }) | undefined;
  private readonly skills = new Map(
    loadRuntimeSkillAssets(join(workspace, 'skills/runtime')).map((skill) => [
      skill.id,
      skill.content
    ])
  );
  private readonly harnessProfiles = new Map(
    loadHarnessProfiles(
      join(workspace, 'harness/profiles.json'),
      join(workspace, 'skills/runtime')
    ).map((profile) => [profile.id, profile])
  );

  constructor(
    private readonly targetBaseUrl: string,
    private readonly executionMode: QualificationExecutionMode,
    private readonly executionProfile: ProjectExecutionProfile,
    private readonly webServer?: { command: string; url: string }
  ) {}

  private shouldUseCursorCli(): boolean {
    return (
      Boolean(process.env.CURSOR_MODEL?.trim()) &&
      Boolean(process.env.CURSOR_API_KEY?.trim()) &&
      agentCliAvailable()
    );
  }

  private generatedTestValidator(): GeneratedTestValidator {
    return {
      validate: async ({ workspace: root, projectId, generatedPaths, scenarioIds }) => {
        try {
          execFileSync(
            process.execPath,
            [join(root, 'node_modules/prettier/bin/prettier.cjs'), '--check', ...generatedPaths],
            { cwd: root, stdio: 'pipe' }
          );
          execFileSync(
            process.execPath,
            [join(root, 'node_modules/eslint/bin/eslint.js'), ...generatedPaths],
            { cwd: root, stdio: 'pipe' }
          );
          execFileSync(
            process.execPath,
            [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'],
            {
              cwd: root,
              stdio: 'pipe'
            }
          );
        } catch (error) {
          return {
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'generated test validation failed'
          };
        }
        const evidenceDirectory = join(
          root,
          `projects/${projectId}/observations/evidence/test-generation`
        );
        mkdirSync(evidenceDirectory, { recursive: true });
        const run = await this.playwright.run({
          workspace: root,
          projectId,
          targetBaseUrl: this.targetBaseUrl,
          reportPath: join(evidenceDirectory, 'targeted-results.json'),
          grep: scenarioIds.join('|'),
          ...(this.webServer ? { webServer: this.webServer } : {})
        });
        return run.status === 'passed'
          ? ({ status: 'passed' as const } as const)
          : ({
              status: 'failed' as const,
              error: run.stderr ?? `targeted Playwright execution exited ${run.exitCode}`
            } as const);
      }
    };
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
      const analysisPath = join(projectRoot, 'derived/reports/failure-analysis.md');
      mkdirSync(dirname(analysisPath), { recursive: true });
      writeFileSync(
        analysisPath,
        generatedMarkdown(
          `# Failure analysis\n\nFailed: ${summary.failed}\n\nClassification: ${summary.failed === 0 ? 'no-failures' : 'needs-triage'}\n\nDeterministic fallback; Cursor Agent CLI was unavailable.\n`
        )
      );
      return { status: 'succeeded' as const, outputs };
    }

    if (step.id === 'report' && command.intent === 'run-test-suite') {
      const reportPath = join(projectRoot, 'observations/evidence/test-runs/results.json');
      const observedStatus = this.playwrightSummary?.status;
      const summary =
        this.playwrightSummary ??
        (existsSync(reportPath)
          ? parsePlaywrightJsonReport(JSON.parse(readFileSync(reportPath, 'utf8')))
          : undefined);
      if (!summary) return { status: 'failed' as const, error: 'Missing Playwright summary' };
      const reportDirectory = join(projectRoot, 'derived/reports');
      mkdirSync(reportDirectory, { recursive: true });
      const runSummary = {
        ...summary,
        runId: command.parameters.requestId
          ? String(command.parameters.requestId)
          : `${command.intent}-run`,
        status: observedStatus ?? (summary.failed === 0 ? 'passed' : 'failed'),
        intent: command.intent,
        projectId: command.project.id,
        suiteLabel: resolvePlaywrightSuite(command.parameters.suite).label
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

  async execute(
    step: WorkflowStep,
    command: NormalizedCommand,
    context: Parameters<StepExecutor['execute']>[2]
  ) {
    const outputs = step.outputs.map(({ artifact, path }) => ({
      artifact,
      path: expand(path, command)
    }));
    const baseHarnessProfile = this.harnessProfiles.get(step.harnessProfileId);
    if (!baseHarnessProfile) {
      return {
        status: 'blocked',
        reason: `unknown harness profile: ${step.harnessProfileId}`
      } as const;
    }
    const executionKind = harnessExecutionKind(baseHarnessProfile);
    if (executionKind === 'host') {
      if (step.id !== 'execute' || step.role !== 'executor') {
        return {
          status: 'blocked',
          reason: `host harness profile violates execution contract: ${step.harnessProfileId}`
        } as const;
      }
      const outcome = await executeTestRunStep({
        workspace,
        step,
        command,
        runner: this.playwright,
        targetBaseUrl: this.targetBaseUrl,
        signal: context.signal,
        ...(this.webServer ? { webServer: this.webServer } : {})
      });
      this.playwrightSummary = outcome.summary;
      if (this.playwrightSummary) {
        writePlaywrightSlackSummary(command, this.playwrightSummary);
      }
      return outcome.result;
    }

    const agentExecutionRoute = selectAgentExecutionRoute(
      command,
      this.shouldUseCursorCli(),
      this.executionMode === 'mock'
    );
    if (agentExecutionRoute === 'deterministic-onboarding') {
      return executeOnboardingMockStep(workspace, step, command);
    }
    if (agentExecutionRoute === 'deterministic-exploration') {
      if (step.id !== 'explore') {
        return executeExplorationStep(workspace, step, command, undefined);
      }
      const evidenceDirectory = join(
        workspace,
        command.project.root,
        'observations/evidence/exploration'
      );
      const config = resolveBrowserServiceConfig(this.executionProfile, {
        ...process.env,
        QALI_BROWSER_EVIDENCE_DIR: evidenceDirectory
      });
      const driver = await PlaywrightBrowserDriver.launch({
        allowedOrigins: config.allowedOrigins,
        browserName: config.browserName,
        ...(config.executablePath ? { executablePath: config.executablePath } : {})
      });
      try {
        const browser = new RestrictedBrowserFacade(driver, config);
        return await executeExplorationStep(workspace, step, command, browser);
      } finally {
        await driver.close();
      }
    }
    if (agentExecutionRoute === 'deterministic-test-generation') {
      return executeTestGenerationStep(
        workspace,
        step,
        command,
        step.id === 'generate-tests' ? this.generatedTestValidator() : undefined
      );
    }
    if (agentExecutionRoute === 'deterministic-fallback') {
      if (this.executionMode !== 'mock') {
        return {
          status: 'blocked',
          reason: 'qualified Cursor Agent runtime is unavailable'
        } as const;
      }
      return this.deterministicAgentStep(step, command, outputs);
    }

    const harnessProfile = selectHarnessProfile(
      [...this.harnessProfiles.values()],
      baseHarnessProfile.id,
      {
        visualTesting:
          command.intent === 'generate-test-suite' && command.parameters.visualTesting === true,
        journeyChange:
          command.intent === 'maintain-knowledge' &&
          command.parameters.knowledgeChangeKind === 'journey'
      }
    );
    if (harnessExecutionKind(harnessProfile) !== 'agent') {
      return {
        status: 'blocked',
        reason: `host harness profile cannot execute through the agent runtime: ${harnessProfile.id}`
      } as const;
    }
    const result = await this.agent.execute({
      workspace,
      role: ROLE_PROFILES[step.role],
      step,
      skillInstructions: harnessProfile.skillIds
        .map((skillId) => this.skills.get(skillId) ?? '')
        .join('\n\n'),
      context: JSON.stringify(command.parameters),
      timeoutMs: step.timeoutMs,
      permissions: step.requiredTools,
      signal: context.signal
    });
    if (result.status === 'succeeded') return { status: 'succeeded', outputs } as const;
    if (result.status === 'blocked') return { status: 'blocked', reason: result.output } as const;
    if (
      /ENOENT|not found|usage limit|spend limit|not authenticated|api key|unauthorized/i.test(
        result.error
      )
    ) {
      if (this.executionMode !== 'mock') {
        return {
          status: 'blocked',
          reason: 'qualified Cursor Agent runtime became unavailable'
        } as const;
      }
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
if (!command.project.executionProfileId) {
  throw new Error('Resolved command is missing project.executionProfileId');
}
const executionProfile = ProjectExecutionProfileSchema.parse(
  JSON.parse(readFileSync(join(workspace, command.project.root, 'execution-profile.json'), 'utf8'))
);
if (executionProfile.id !== command.project.executionProfileId) {
  throw new Error(
    `Execution profile mismatch: expected ${command.project.executionProfileId}, found ${executionProfile.id}`
  );
}
const executionTarget = resolveExecutionTarget(executionProfile, process.env);
const executionMode = qualificationExecutionMode(executionProfile.environmentLabel, false);
if (executionMode !== 'mock') {
  const primaryModel = process.env.CURSOR_MODEL?.trim();
  if (!primaryModel || !process.env.CURSOR_API_KEY?.trim() || !agentCliAvailable()) {
    throw new Error('Qualified Cursor Agent runtime is required outside Mock Mode');
  }
  const failoverModels = (() => {
    const raw = process.env.QALI_CURSOR_FAILOVER_MODELS_JSON;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.some((model) => typeof model !== 'string' || !model.trim())
    ) {
      throw new Error('QALI_CURSOR_FAILOVER_MODELS_JSON must be a JSON string array');
    }
    return parsed.map((model) => model.trim());
  })();
  const cursorCliVersion = execFileSync('agent', ['--version'], { encoding: 'utf8' }).trim();
  if (!cursorCliVersion) throw new Error('Cursor Agent CLI did not report a version');
  const candidates = [primaryModel, ...failoverModels].map((modelIdentifier) =>
    computeRuntimeQualificationIdentity({
      repositoryRoot: workspace,
      cursorCliVersion,
      modelIdentifier
    })
  );
  const registry = loadQualificationRegistry(join(workspace, 'qualification/registry.json'));
  const qualification = selectQualifiedCombination({
    mode: executionMode,
    candidates,
    records: registry.records,
    now: new Date()
  });
  if (!qualification.allowed) throw new Error(qualification.reason);
  process.env.CURSOR_MODEL = qualification.candidate.modelIdentifier;
}
mkdirSync(join(workspace, '.qali'), { recursive: true });
const transientSlackSummaryPath = join(workspace, '.qali/slack-summary.json');
if (existsSync(transientSlackSummaryPath)) unlinkSync(transientSlackSummaryPath);
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
  join(workspace, 'harness/profiles.json')
);
const harnessCatalogHash = createHash('sha256')
  .update(readFileSync(join(workspace, 'harness/profiles.json')))
  .digest('hex');
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
  executor: new RoutedStepExecutor(
    executionTarget.baseUrl,
    executionMode,
    executionProfile,
    executionTarget.webServer
  ),
  events: new FileEventStore(eventPath),
  outputValidator: new FileSystemOutputValidator(workspace),
  harnessHash: () => harnessCatalogHash
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
  if (
    shouldWriteFallbackPlaywrightSummary({
      intent: command.intent,
      resultsExist: existsSync(resultsPath),
      executorSummaryExists: existsSync(transientSlackSummaryPath)
    })
  ) {
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
