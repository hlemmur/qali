import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  ProjectRegistrySchema,
  type ArtifactReference,
  type NormalizedCommand,
  type WorkflowStep
} from '../../contracts/src/index.js';
import { scaffoldProject } from '../../knowledge/src/index.js';
import type { StepExecutionResult } from './execution.js';
import { executeExplorationStep, type ExplorationBrowser } from './exploration.js';
import {
  PROJECT_SCHEDULE_RELATIVE_PATH,
  scheduleTemplate,
  writeProjectSchedule
} from './project-schedule.js';

const FACT_CATEGORIES = [
  'product',
  'tech-stack',
  'test-stack',
  'ci-cd',
  'environment',
  'quality-goal',
  'team',
  'convention'
] as const;

const OnboardingEvidenceSchema = z
  .object({
    version: z.literal(1),
    projectName: z.string().min(1),
    observedAt: z.iso.date(),
    facts: z.array(
      z
        .object({
          id: z.string().regex(/^FACT-[0-9]+$/),
          category: z.enum(FACT_CATEGORIES),
          statement: z.string().min(1),
          source: z.string().min(1)
        })
        .strict()
    ),
    journeys: z.array(
      z
        .object({
          id: z.string().regex(/^JRN-[0-9]+$/),
          actor: z.string().min(1),
          goal: z.string().min(1),
          steps: z.array(z.string().min(1)).min(1),
          outcome: z.string().min(1),
          requirementIds: z.array(z.string().regex(/^REQ-[0-9]+$/)),
          source: z.string().min(1)
        })
        .strict()
    ),
    risks: z.array(
      z
        .object({
          id: z.string().regex(/^RSK-[0-9]+$/),
          statement: z.string().min(1),
          impact: z.number().int().min(1).max(5),
          probability: z.number().int().min(1).max(5),
          source: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();

const SECTIONS: Array<{
  title: string;
  category: (typeof FACT_CATEGORIES)[number];
  question: string;
}> = [
  { title: 'Product', category: 'product', question: 'What does the project do?' },
  {
    title: 'Tech Stack',
    category: 'tech-stack',
    question: 'What is the project tech stack?'
  },
  {
    title: 'Test Stack',
    category: 'test-stack',
    question: 'What test stack does the project use?'
  },
  { title: 'CI/CD', category: 'ci-cd', question: 'How does CI/CD run for this project?' },
  {
    title: 'Environments',
    category: 'environment',
    question: 'Which environments are available for QA?'
  },
  {
    title: 'Quality Goals',
    category: 'quality-goal',
    question: 'Which quality goals have authority approval?'
  },
  { title: 'Team', category: 'team', question: 'Who owns product and quality decisions?' },
  {
    title: 'Conventions',
    category: 'convention',
    question: 'Which project conventions must QA follow?'
  }
];

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function outputsFor(step: WorkflowStep, command: NormalizedCommand): ArtifactReference[] {
  return step.outputs.map(({ artifact, path }) => ({ artifact, path: expand(path, command) }));
}

function generatedMarkdown(body: string): string {
  const normalized = `\n\n${body.trim()}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
}

function targetUrlFrom(command: NormalizedCommand): string | undefined {
  const value = command.parameters.targetUrl ?? command.parameters.origin;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function evidenceFromTarget(command: NormalizedCommand): z.infer<typeof OnboardingEvidenceSchema> {
  const targetUrl = targetUrlFrom(command) ?? `https://${command.project.id}`;
  const observedAt = command.receivedAt.slice(0, 10);
  return {
    version: 1,
    projectName: command.project.id,
    observedAt,
    facts: [
      {
        id: 'FACT-001',
        category: 'environment',
        statement: `The live target origin for ${command.project.id} is ${targetUrl}.`,
        source: targetUrl
      }
    ],
    journeys: [],
    risks: []
  };
}

export interface PrepareOnboardProjectOptions {
  templateRoot?: string;
}

export function upsertOnboardedProjectRegistry(
  workspace: string,
  command: NormalizedCommand
): void {
  const registryPath = join(workspace, 'projects/registry.json');
  if (!existsSync(registryPath) || command.intent !== 'onboard-project') return;
  const registry = ProjectRegistrySchema.parse(JSON.parse(readFileSync(registryPath, 'utf8')));
  if (registry.projects.some((project) => project.id === command.project.id)) return;
  const channelId = command.slack?.channelId;
  const matched = channelId
    ? registry.projects.filter((project) => project.allowedSlack.channelIds.includes(channelId))
    : [];
  const donor =
    matched.length === 1
      ? matched[0]
      : registry.projects.length === 1
        ? registry.projects[0]
        : undefined;
  if (!donor) {
    throw new Error(
      'onboard registry donor is ambiguous; Slack channel must match exactly one project'
    );
  }
  const root = command.project.root.startsWith('projects/')
    ? command.project.root
    : `projects/${command.project.id}`;
  registry.projects.push({
    ...donor,
    id: command.project.id,
    root,
    githubEnvironment: command.project.environment ?? `qali-${command.project.id}`,
    activeExecutionProfile:
      command.project.executionProfileId ?? `${command.project.id}-production`,
    schedules: scheduleTemplate('conservative').jobs
  });
  writeFileSync(
    registryPath,
    `${JSON.stringify(ProjectRegistrySchema.parse(registry), null, 2)}\n`
  );
}

export function prepareOnboardProject(
  workspace: string,
  command: NormalizedCommand,
  options: PrepareOnboardProjectOptions = {}
): void {
  if (command.intent !== 'onboard-project') return;
  const projectRoot = join(workspace, command.project.root);
  if (!existsSync(projectRoot)) {
    const templateRoot = options.templateRoot ?? join(workspace, 'projects/_template');
    scaffoldProject(command.project.id, {
      projectsRoot: join(workspace, 'projects'),
      templateRoot
    });
    const profilePath = join(projectRoot, 'execution-profile.json');
    if (existsSync(profilePath) && command.project.executionProfileId) {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
      profile.id = command.project.executionProfileId;
      profile.projectId = command.project.id;
      if (command.project.environmentLabel)
        profile.environmentLabel = command.project.environmentLabel;
      delete profile.displayBadge;
      delete profile.webServer;
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    }
  }
  upsertOnboardedProjectRegistry(workspace, command);
  const evidencePath = join(projectRoot, 'sources/reference/onboarding-evidence.json');
  if (!existsSync(evidencePath)) {
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidenceFromTarget(command), null, 2)}\n`);
  }
}

export async function executeOnboardingMockStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand,
  browser?: ExplorationBrowser
): Promise<StepExecutionResult> {
  if (command.intent !== 'onboard-project') {
    return { status: 'failed', error: `Unsupported onboarding step: ${step.id}` };
  }
  const projectRoot = join(workspace, command.project.root);
  const evidencePath = join(projectRoot, 'sources/reference/onboarding-evidence.json');
  const evidence = OnboardingEvidenceSchema.parse(JSON.parse(readFileSync(evidencePath, 'utf8')));
  const outputs = outputsFor(step, command);
  for (const output of outputs)
    mkdirSync(dirname(join(workspace, output.path)), { recursive: true });

  if (step.id === 'discover-project') {
    const context = [
      '# QA Project Context',
      '',
      ...SECTIONS.flatMap(({ title, category }) => {
        const facts = evidence.facts.filter((fact) => fact.category === category);
        return [
          `## ${title}`,
          '',
          ...(facts.length
            ? facts.flatMap((fact) => [
                `- ${fact.id} | ${fact.statement}`,
                `  - Source: \`${fact.source}\``,
                `  - Observed: ${evidence.observedAt}`
              ])
            : ['Unknown']),
          ''
        ];
      })
    ].join('\n');
    writeFileSync(join(projectRoot, 'sources/project-context.md'), `${context.trimEnd()}\n`);

    const unknownQuestions = SECTIONS.filter(
      ({ category }) => !evidence.facts.some((fact) => fact.category === category)
    ).map(({ question }) => question);
    if (evidence.journeys.length === 0) {
      unknownQuestions.push('Which user journeys are authoritative for this project?');
    }
    if (evidence.risks.length === 0) {
      unknownQuestions.push('Which product risks have supporting evidence?');
    }
    const questions = [
      '# Questions',
      '',
      '| ID | Question | Status | Blocking | Owner | Source | Asked | Answer / decision |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...unknownQuestions.map(
        (question, index) =>
          `| Q-${String(index + 1).padStart(3, '0')} | ${question} | open | no | unassigned | onboarding evidence gap | ${evidence.observedAt} | |`
      ),
      ''
    ].join('\n');
    writeFileSync(join(projectRoot, 'sources/questions.md'), questions);

    const discovery = [
      '# Onboarding Discovery Evidence',
      '',
      `Project: ${evidence.projectName}`,
      `Observed: ${evidence.observedAt}`,
      'Source file: `onboarding-evidence.json`',
      '',
      ...evidence.facts.map(
        (fact) => `- ${fact.id} | ${fact.statement} | Source: \`${fact.source}\``
      ),
      ''
    ].join('\n');
    writeFileSync(join(projectRoot, 'sources/reference/discovery.md'), discovery);
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'discover-journeys') {
    const journeys = [
      '# User Journeys',
      '',
      ...(evidence.journeys.length
        ? evidence.journeys.flatMap((journey) => [
            `## ${journey.id}: ${journey.goal}`,
            '',
            `- Actor: ${journey.actor}`,
            `- Goal: ${journey.goal}`,
            `- Steps: ${journey.steps.join('; ')}`,
            `- Outcome: ${journey.outcome}`,
            `- Requirement links: ${journey.requirementIds.join(', ') || 'Unknown'}`,
            `- Source: \`${journey.source}\``,
            `- Observed: ${evidence.observedAt}`,
            ''
          ])
        : ['Unknown. No evidence-backed journeys were supplied.', ''])
    ].join('\n');
    writeFileSync(join(projectRoot, 'sources/reference/journeys.md'), journeys);
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'assess-risks') {
    const risks = [
      '# Product Risk Assessment',
      '',
      '| ID | Risk | Impact | Probability | Priority | Source | Observed |',
      '| --- | --- | ---: | ---: | ---: | --- | --- |',
      ...(evidence.risks.length
        ? evidence.risks.map(
            (risk) =>
              `| ${risk.id} | ${risk.statement} | ${risk.impact} | ${risk.probability} | ${risk.impact * risk.probability} | ${risk.source} | ${evidence.observedAt} |`
          )
        : [
            '| Unknown | No evidence-backed risks were supplied. | Unknown | Unknown | Unknown | onboarding evidence gap | Unknown |'
          ])
    ].join('\n');
    writeFileSync(
      join(projectRoot, 'derived/reports/risk-assessment.md'),
      generatedMarkdown(risks)
    );
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'plan-strategy') {
    const rankedRisks = [...evidence.risks].sort(
      (left, right) => right.impact * right.probability - left.impact * left.probability
    );
    const scenario = [
      '# Smoke Scenario Proposal',
      '',
      ...(evidence.journeys.length
        ? evidence.journeys.flatMap((journey) => [
            `## ${journey.id}: ${journey.goal}`,
            '',
            `- Actor: ${journey.actor}`,
            `- Evidence: \`${journey.source}\``,
            `- Requirements: ${journey.requirementIds.join(', ') || 'Unknown'}`,
            `- Expected outcome: ${journey.outcome}`,
            '- Status: proposed; authority approval required',
            ''
          ])
        : ['No smoke scenarios proposed because no evidence-backed journeys were supplied.', ''])
    ].join('\n');
    writeFileSync(
      join(projectRoot, 'derived/scenarios/smoke-proposal.md'),
      generatedMarkdown(scenario)
    );
    const strategyItems = [
      ...(rankedRisks.length
        ? rankedRisks.map(
            (risk) =>
              `- Prioritize \`${risk.id}\` (score ${risk.impact * risk.probability}) from \`${risk.source}\`.`
          )
        : ['- Risk-based prioritization is unknown until supporting risk evidence is supplied.'])
    ];
    const planItems = [
      ...(evidence.journeys.length
        ? evidence.journeys.map(
            (journey) =>
              `- Validate \`${journey.id}\` against ${journey.requirementIds.join(', ') || 'unconfirmed requirements'}; keep the scenario proposed until approved.`
          )
        : ['- Gather authoritative journey evidence before proposing executable coverage.'])
    ];
    const strategy = ['# Test Strategy', '', ...strategyItems, ''].join('\n');
    const initialPlan = ['# Initial Test Plan', '', ...planItems, ''].join('\n');
    writeFileSync(join(projectRoot, 'derived/strategy.md'), generatedMarkdown(strategy));
    writeFileSync(join(projectRoot, 'derived/plan.md'), generatedMarkdown(initialPlan));
    const plan = [
      '# Initial Test Strategy and Plan',
      '',
      '## Strategy',
      '',
      ...strategyItems,
      '',
      '## Initial Plan',
      '',
      ...planItems,
      '',
      '## Guardrails',
      '',
      '- Unknown facts remain open questions; they are not converted into assumptions.',
      '- Proposed scenarios require authority approval before test generation.',
      ''
    ].join('\n');
    writeFileSync(
      join(projectRoot, 'derived/reports/initial-test-plan.md'),
      generatedMarkdown(plan)
    );
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'first-explore') {
    const charter = await executeExplorationStep(
      workspace,
      { ...step, id: 'charter' },
      command,
      undefined
    );
    if (charter.status !== 'succeeded') return charter;
    if (browser) {
      const explored = await executeExplorationStep(
        workspace,
        { ...step, id: 'explore' },
        command,
        browser
      );
      return explored.status === 'succeeded'
        ? { status: 'succeeded', outputs: explored.outputs }
        : explored;
    }
    const evidenceDirectory = join(
      workspace,
      command.project.root,
      'observations/evidence/exploration'
    );
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      join(evidenceDirectory, 'onboard-first-explore.json'),
      `${JSON.stringify(
        {
          version: 1,
          status: 'charter-only',
          targetUrl: targetUrlFrom(command) ?? `https://${command.project.id}`
        },
        null,
        2
      )}\n`
    );
    return { status: 'succeeded', outputs };
  }

  if (step.id === 'first-explore-report') {
    const reported = await executeExplorationStep(
      workspace,
      { ...step, id: 'report' },
      command,
      undefined
    );
    return reported.status === 'succeeded'
      ? { status: 'succeeded', outputs: reported.outputs }
      : reported;
  }

  if (step.id === 'seed-schedule') {
    const projectRoot = join(workspace, command.project.root);
    if (!existsSync(join(projectRoot, PROJECT_SCHEDULE_RELATIVE_PATH))) {
      writeProjectSchedule(projectRoot, scheduleTemplate('conservative'));
    }
    return { status: 'succeeded', outputs };
  }

  return { status: 'failed', error: `Unsupported onboarding step: ${step.id}` };
}

const ONBOARDING_EVIDENCE_PATHS = [
  'sources/project-context.md',
  'sources/questions.md',
  'sources/reference/discovery.md',
  'sources/reference/journeys.md',
  'sources/reference/risks.md',
  'derived/strategy.md',
  'derived/plan.md',
  'derived/reports/risk-assessment.md',
  'derived/reports/initial-test-plan.md',
  'observations/exploration.md',
  'derived/reports/exploration.md',
  'derived/workflow-state/schedule.yaml'
] as const;

export function summarizeOnboardingReport(projectRoot: string): {
  findings: string[];
  evidence: string[];
} {
  const evidence = ONBOARDING_EVIDENCE_PATHS.filter((relative) =>
    existsSync(join(projectRoot, relative))
  );
  const questionsPath = join(projectRoot, 'sources/questions.md');
  const findings: string[] = [];
  if (existsSync(questionsPath)) {
    for (const line of readFileSync(questionsPath, 'utf8').split('\n')) {
      const match = /^\|\s*(Q-\d+)\s*\|\s*([^|]+)\|\s*open\s*\|/i.exec(line);
      if (match?.[1] && match[2]) findings.push(`${match[1]} ${match[2].trim()}`);
    }
  }
  return { findings: findings.slice(0, 12), evidence };
}
