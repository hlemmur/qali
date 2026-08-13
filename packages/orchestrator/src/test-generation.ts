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
  playwright?: PlaywrightScenario;
}

interface PlaywrightScenario {
  path: string;
  actions: Array<
    { kind: 'fill'; label: string; value: string } | { kind: 'click'; role: string; name: string }
  >;
  assertions: Array<
    | { kind: 'visible'; role: string; name: string }
    | { kind: 'text'; testId: string; value: string }
  >;
}

const quoted = (value: string): string =>
  `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`;

function playwrightScenario(body: string): PlaywrightScenario | undefined {
  const encoded = /```json qali-playwright\s*\n([\s\S]*?)\n```/i.exec(body)?.[1];
  if (!encoded) return undefined;
  const value = JSON.parse(encoded) as PlaywrightScenario;
  if (
    typeof value.path !== 'string' ||
    !value.path.startsWith('/') ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.assertions)
  ) {
    throw new Error('invalid qali-playwright scenario');
  }
  return value;
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
    const playwright = playwrightScenario(body);
    return [{ id: heading[1]!, requirementIds, ...(playwright ? { playwright } : {}) }];
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
  const projectRoot = join(workspace, command.project.root);
  const scenarioDirectory = join(projectRoot, 'derived/scenarios/approved');
  const scenarios = readdirSync(scenarioDirectory)
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) => approvedScenarios(readFileSync(join(scenarioDirectory, name), 'utf8')));
  if (step.id === 'generate-tests') {
    const generatedDirectory = join(projectRoot, 'tests/generated');
    mkdirSync(generatedDirectory, { recursive: true });
    for (const scenario of scenarios) {
      if (!scenario.playwright) continue;
      const lines = [
        "import { expect, test } from '@playwright/test';",
        '',
        `// Approved scenario: ${scenario.id}`,
        `// Requirements: ${scenario.requirementIds.join(', ')}`,
        `test(${quoted(`${scenario.id} generated scenario`)}, async ({ page }) => {`,
        `  await page.goto(${quoted(scenario.playwright.path)});`
      ];
      for (const action of scenario.playwright.actions) {
        if (action.kind === 'fill') {
          lines.push(
            `  await page.getByLabel(${quoted(action.label)}).fill(${quoted(action.value)});`
          );
        } else if (action.kind === 'click') {
          lines.push(
            `  await page.getByRole(${quoted(action.role)}, { name: ${quoted(action.name)} }).click();`
          );
        }
      }
      for (const assertion of scenario.playwright.assertions) {
        if (assertion.kind === 'visible') {
          lines.push(
            `  await expect(page.getByRole(${quoted(assertion.role)}, { name: ${quoted(assertion.name)} })).toBeVisible();`
          );
        } else if (assertion.kind === 'text') {
          lines.push(
            `  await expect(page.getByTestId(${quoted(assertion.testId)})).toHaveText(${quoted(assertion.value)});`
          );
        }
      }
      lines.push('});', '');
      writeFileSync(
        join(generatedDirectory, `${scenario.id.toLowerCase()}.generated.spec.ts`),
        lines.join('\n')
      );
    }
    return { status: 'succeeded' as const, outputs };
  }
  if (step.id !== 'design-coverage') {
    return { status: 'blocked' as const, reason: `unsupported test-generation step: ${step.id}` };
  }
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
