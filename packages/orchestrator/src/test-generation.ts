import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';

const expand = (path: string, command: NormalizedCommand): string =>
  path.replaceAll('{projectId}', command.project.id);

const generatedMarkdown = (body: string): string => {
  const normalized = `\n\n${body.trim()}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

interface ApprovedScenario {
  id: string;
  requirementIds: string[];
}

function approvedScenarios(markdown: string): ApprovedScenario[] {
  const headings = [...markdown.matchAll(/^##\s+([A-Z][A-Z0-9-]+):[^\n]*$/gm)];
  return headings.flatMap((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    if (!/^-\s*Status:\s*approved for automation\s*$/im.test(body)) return [];
    const traceability = /^-\s*Traceability:\s*(.+)$/im.exec(body)?.[1] ?? '';
    const requirementIds = [...traceability.matchAll(/\bREQ-\d+\b/g)].map(([id]) => id);
    return [{ id: heading[1]!, requirementIds }];
  });
}

function requirementStatuses(markdown: string): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (/^REQ-\d+$/.test(cells[0] ?? '') && cells[2]) statuses.set(cells[0]!, cells[2]!);
  }
  return statuses;
}

export async function executeTestGenerationStep(
  workspace: string,
  step: WorkflowStep,
  command: NormalizedCommand
) {
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  if (step.id !== 'design-coverage') {
    return { status: 'blocked' as const, reason: `unsupported test-generation step: ${step.id}` };
  }

  const projectRoot = join(workspace, command.project.root);
  const scenarioDirectory = join(projectRoot, 'derived/scenarios/approved');
  const scenarios = readdirSync(scenarioDirectory)
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) => approvedScenarios(readFileSync(join(scenarioDirectory, name), 'utf8')));
  const statuses = requirementStatuses(
    readFileSync(join(projectRoot, 'sources/reference/requirements.md'), 'utf8')
  );
  const rows = scenarios.flatMap((scenario) =>
    scenario.requirementIds.map(
      (requirementId) =>
        `| ${scenario.id} | ${requirementId} | ${statuses.get(requirementId) ?? 'missing'} |`
    )
  );
  const coveragePath = join(projectRoot, 'derived/scenarios/coverage-map.md');
  mkdirSync(dirname(coveragePath), { recursive: true });
  writeFileSync(
    coveragePath,
    generatedMarkdown(
      [
        '# Approved scenario coverage',
        '',
        '| Scenario | Requirement | Requirement status |',
        '| --- | --- | --- |',
        ...rows
      ].join('\n')
    )
  );
  return { status: 'succeeded' as const, outputs };
}
