import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { z } from 'zod';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { parsePlaywrightJsonReport } from '../../playwright/src/index.js';
import type { StepExecutionResult } from './execution.js';

interface SourceFile {
  path: string;
  contents: string;
}

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function files(root: string, directory: string, suffix: string): SourceFile[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) return files(root, relative(root, path), suffix);
    return entry.name.endsWith(suffix)
      ? [{ path: relative(root, path).replaceAll('\\', '/'), contents: readFileSync(path, 'utf8') }]
      : [];
  });
}

function source(root: string, path: string): SourceFile | undefined {
  const absolute = join(root, path);
  return existsSync(absolute) ? { path, contents: readFileSync(absolute, 'utf8') } : undefined;
}

function headingIds(markdown: string, prefix: string): string[] {
  return [...markdown.matchAll(new RegExp(`^##\\s+(${prefix}[A-Z0-9-]*)(?::|\\s|$)`, 'gim'))].map(
    (match) => match[1]!
  );
}

function tableStatusCount(markdown: string, status: string): number {
  return markdown
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .filter((line) => line.split('|').some((cell) => cell.trim().toLowerCase() === status)).length;
}

function generatedJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function generatedMarkdown(body: string): string {
  const normalized = `\n\n${body.trim()}\n`;
  const digest = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${digest} -->${normalized}`;
}

const presentation = {
  title: 'Quality pulse',
  sections: {
    runs: 'Run health',
    risks: 'Risk posture',
    coverage: 'Coverage',
    decisions: 'Open decisions',
    sources: 'Evidence sources'
  }
};

const count = z.number().int().nonnegative();
const QualityPulseFactBodySchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().min(1),
    generatedAt: z.iso.datetime(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    runs: z
      .object({
        count,
        total: count,
        passed: count,
        failed: count,
        skipped: count,
        durationMs: z.number().finite().nonnegative()
      })
      .strict(),
    risks: z.object({ total: count, open: count }).strict(),
    failures: z.object({ count }).strict(),
    coverage: z
      .object({
        approvedScenarios: count,
        automatedScenarios: count,
        percent: z.number().finite().min(0).max(100)
      })
      .strict(),
    openDecisions: z.object({ questions: count, proposedDecisions: count, total: count }).strict(),
    sources: z.array(z.string().min(1)).default([])
  })
  .strict();
const QualityPulseFactsSchema = QualityPulseFactBodySchema.extend({
  factsHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

function parseFacts(input: unknown, projectId: string): z.infer<typeof QualityPulseFactsSchema> {
  const facts = QualityPulseFactsSchema.parse(input);
  const { factsHash, ...body } = facts;
  if (
    facts.projectId !== projectId ||
    createHash('sha256').update(JSON.stringify(body)).digest('hex') !== factsHash
  ) {
    throw new Error('quality pulse facts are invalid');
  }
  return facts;
}

function parsePresentation(input: unknown): typeof presentation {
  if (!input || typeof input !== 'object') throw new Error('quality pulse presentation is invalid');
  const value = input as { title?: unknown; sections?: Record<string, unknown> };
  const keys = ['runs', 'risks', 'coverage', 'decisions', 'sources'] as const;
  if (
    typeof value.title !== 'string' ||
    !value.sections ||
    keys.some(
      (key) =>
        typeof value.sections?.[key] !== 'string' ||
        !String(value.sections[key]).trim() ||
        String(value.sections[key]).length > 80 ||
        /[\d\r\n]/.test(String(value.sections[key]))
    ) ||
    value.title.length > 80 ||
    /[\d\r\n]/.test(value.title)
  ) {
    throw new Error('quality pulse presentation is invalid');
  }
  return value as typeof presentation;
}

export async function executeQualityPulseStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Promise<StepExecutionResult> {
  if (command.intent !== 'quality-pulse' || !['aggregate', 'present', 'render'].includes(step.id)) {
    return { status: 'blocked', reason: 'unsupported deterministic quality-pulse step' };
  }
  const projectRoot = join(workspace, command.project.root);
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const factsPath = join(projectRoot, 'observations/evidence/quality-pulse/facts.json');
  const presentationPath = join(projectRoot, 'derived/reports/quality-pulse-presentation.json');
  if (step.id === 'present') {
    for (const output of outputs) {
      const path = join(workspace, output.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, generatedJson(presentation));
    }
    return { status: 'succeeded', outputs };
  }
  if (step.id === 'render') {
    if (!existsSync(factsPath) || !existsSync(presentationPath)) {
      return { status: 'failed', error: 'quality pulse facts or presentation is missing' };
    }
    let facts: z.infer<typeof QualityPulseFactsSchema>;
    try {
      facts = parseFacts(JSON.parse(readFileSync(factsPath, 'utf8')), command.project.id);
    } catch {
      return { status: 'failed', error: 'quality pulse facts are invalid' };
    }
    let labels: typeof presentation;
    try {
      labels = parsePresentation(JSON.parse(readFileSync(presentationPath, 'utf8')));
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    const body = [
      `# ${labels.title}`,
      '',
      `## ${labels.sections.runs}`,
      '',
      `- Runs: ${facts.runs.count}`,
      `- Tests: ${facts.runs.total} total, ${facts.runs.passed} passed, ${facts.runs.failed} failed, ${facts.runs.skipped} skipped`,
      `- Duration: ${facts.runs.durationMs} ms`,
      '',
      `## ${labels.sections.risks}`,
      '',
      `- Risks: ${facts.risks.total} total, ${facts.risks.open} open`,
      `- Observed failures: ${facts.failures.count}`,
      '',
      `## ${labels.sections.coverage}`,
      '',
      `- Coverage: ${facts.coverage.automatedScenarios}/${facts.coverage.approvedScenarios} approved scenarios automated (${facts.coverage.percent}%)`,
      '',
      `## ${labels.sections.decisions}`,
      '',
      `- Open decisions: ${facts.openDecisions.total} (${facts.openDecisions.questions} questions, ${facts.openDecisions.proposedDecisions} proposed decisions)`,
      '',
      `## ${labels.sections.sources}`,
      '',
      ...facts.sources.map((path) => `- \`${path}\``)
    ].join('\n');
    for (const output of outputs) {
      const path = join(workspace, output.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, generatedMarkdown(body));
    }
    return { status: 'succeeded', outputs };
  }
  const canonicalRun = source(projectRoot, 'observations/evidence/test-runs/results.json');
  const runFiles = canonicalRun ? [canonicalRun] : [];
  const runSummaries = runFiles.map(({ contents }) =>
    parsePlaywrightJsonReport(JSON.parse(contents))
  );
  const riskFiles = files(projectRoot, 'sources/reference', '.md').filter(({ path }) =>
    /(?:^|\/)risks?\.md$/i.test(path)
  );
  const scenarioFiles = files(projectRoot, 'derived/scenarios/approved', '.md');
  const testFiles = files(projectRoot, 'tests', '.spec.ts');
  const questions = source(projectRoot, 'sources/questions.md');
  const decisions = source(projectRoot, 'sources/decisions.md');
  const risks = riskFiles.flatMap(({ contents }) => {
    const headings = [...contents.matchAll(/^##\s+(RISK-[A-Z0-9-]+)(?::|\s|$)/gim)];
    return headings.map((heading, index) => {
      const body = contents.slice(
        heading.index + heading[0].length,
        headings[index + 1]?.index ?? contents.length
      );
      return { id: heading[1]!, open: /(?:^|\n)\s*-\s*Status:\s*open\b/im.test(body) };
    });
  });
  const approvedIds = [
    ...new Set(scenarioFiles.flatMap(({ contents }) => headingIds(contents, '[A-Z]+-')))
  ];
  const automatedIds = approvedIds.filter((id) =>
    testFiles.some(({ contents }) => contents.includes(id))
  );
  const sources = [
    ...runFiles,
    ...riskFiles,
    ...scenarioFiles,
    ...testFiles,
    ...(questions ? [questions] : []),
    ...(decisions ? [decisions] : [])
  ]
    .map(({ path }) => path)
    .sort();
  const sourceHash = createHash('sha256')
    .update(
      [
        ...runFiles,
        ...riskFiles,
        ...scenarioFiles,
        ...testFiles,
        ...(questions ? [questions] : []),
        ...(decisions ? [decisions] : [])
      ]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ path, contents }) => `${path}\u0000${contents}`)
        .join('\u0000')
    )
    .digest('hex');
  const factBody = {
    version: 1,
    projectId: command.project.id,
    generatedAt: command.receivedAt,
    sourceHash,
    runs: {
      count: runSummaries.length,
      total: runSummaries.reduce((total, run) => total + run.total, 0),
      passed: runSummaries.reduce((total, run) => total + run.passed, 0),
      failed: runSummaries.reduce((total, run) => total + run.failed, 0),
      skipped: runSummaries.reduce((total, run) => total + run.skipped, 0),
      durationMs: runSummaries.reduce((total, run) => total + run.durationMs, 0)
    },
    risks: { total: risks.length, open: risks.filter(({ open }) => open).length },
    failures: { count: runSummaries.reduce((total, run) => total + run.failed, 0) },
    coverage: {
      approvedScenarios: approvedIds.length,
      automatedScenarios: automatedIds.length,
      percent: approvedIds.length ? Math.round((automatedIds.length / approvedIds.length) * 100) : 0
    },
    openDecisions: {
      questions: questions ? tableStatusCount(questions.contents, 'open') : 0,
      proposedDecisions: decisions ? tableStatusCount(decisions.contents, 'proposed') : 0,
      total:
        (questions ? tableStatusCount(questions.contents, 'open') : 0) +
        (decisions ? tableStatusCount(decisions.contents, 'proposed') : 0)
    },
    sources
  };
  const facts = {
    ...factBody,
    factsHash: createHash('sha256').update(JSON.stringify(factBody)).digest('hex')
  };
  for (const output of outputs) {
    const path = join(workspace, output.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, generatedJson(facts));
  }
  return { status: 'succeeded', outputs };
}
