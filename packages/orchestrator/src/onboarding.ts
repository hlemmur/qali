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
    journeys: z.array(z.unknown()),
    risks: z.array(z.unknown())
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

export async function executeOnboardingMockStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (command.intent !== 'onboard-project' || step.id !== 'discover-project') {
    return { status: 'failed', error: `Unsupported onboarding step: ${step.id}` };
  }
  const projectRoot = join(workspace, command.project.root);
  const evidencePath = join(projectRoot, 'sources/reference/onboarding-evidence.json');
  const evidence = OnboardingEvidenceSchema.parse(JSON.parse(readFileSync(evidencePath, 'utf8')));
  const outputs = outputsFor(step, command);
  for (const output of outputs) mkdirSync(dirname(join(workspace, output.path)), { recursive: true });

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

  const unknowns = SECTIONS.filter(
    ({ category }) => !evidence.facts.some((fact) => fact.category === category)
  );
  const questions = [
    '# Questions',
    '',
    '| ID | Question | Status | Blocking | Owner | Source | Asked | Answer / decision |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...unknowns.map(
      ({ question }, index) =>
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
