import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type {
  ArtifactReference,
  NormalizedCommand,
  WorkflowStep
} from '../../contracts/src/index.js';
import type { StepExecutionResult } from './execution.js';

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

export async function executeOnboardingMockStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
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
    writeFileSync(join(projectRoot, 'sources/reference/risks.md'), `${risks}\n`);
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

  return { status: 'failed', error: `Unsupported onboarding step: ${step.id}` };
}
