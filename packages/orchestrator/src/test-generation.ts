import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { NormalizedCommand, WorkflowStep } from '../../contracts/src/index.js';
import { format } from 'prettier';
import { z } from 'zod';

const expand = (path: string, command: NormalizedCommand): string =>
  path.replaceAll('{projectId}', command.project.id);

function generationRequestId(command: NormalizedCommand): string | undefined {
  const value = command.parameters.generationRequestId ?? command.parameters.sourceRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function specMatchesGenerationRequest(content: string, requestId: string): boolean {
  const match = content.match(/^\/\/ Generation request: (.+)$/m);
  return match?.[1]?.trim() === requestId;
}

const generatedMarkdown = (body: string): string => {
  const normalized = `\n\n${body.trim()}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
};

interface ApprovedScenario {
  id: string;
  requirementIds: string[];
  source: 'approved' | 'journey';
  playwright?: PlaywrightScenario;
}

const RoleSchema = z.enum([
  'alert',
  'button',
  'checkbox',
  'heading',
  'link',
  'listitem',
  'menuitem',
  'option',
  'radio',
  'row',
  'tab',
  'textbox'
]);
const ScreenshotNameSchema = z.string().regex(/^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._-]*\.png$/);
const PlaywrightScenarioSchema = z
  .object({
    path: z.string().refine((value) => {
      const pathname = value.split(/[?#]/, 1)[0] ?? '';
      return (
        value.startsWith('/') &&
        !value.startsWith('//') &&
        !value.includes('//') &&
        !/[\\\s]/.test(value) &&
        !pathname.split('/').some((segment) => segment === '.' || segment === '..')
      );
    }),
    actions: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('fill'), label: z.string().min(1), value: z.string() }).strict(),
        z
          .object({
            kind: z.literal('fillNamed'),
            locator: z.enum(['label', 'placeholder']),
            name: z.string().min(1),
            source: z.enum(['credentials', 'testData']),
            field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)
          })
          .strict(),
        z.object({ kind: z.literal('click'), role: RoleSchema, name: z.string().min(1) }).strict()
      ])
    ),
    assertions: z.array(
      z.discriminatedUnion('kind', [
        z
          .object({ kind: z.literal('visible'), role: RoleSchema, name: z.string().min(1) })
          .strict(),
        z
          .object({ kind: z.literal('text'), testId: z.string().min(1), value: z.string() })
          .strict(),
        z.object({ kind: z.literal('roleText'), role: RoleSchema, value: z.string() }).strict(),
        z.object({ kind: z.literal('visual'), name: ScreenshotNameSchema }).strict(),
        z.object({ kind: z.literal('evidenceScreenshot'), name: ScreenshotNameSchema }).strict()
      ])
    )
  })
  .strict();
type PlaywrightScenario = z.infer<typeof PlaywrightScenarioSchema>;

export interface GeneratedTestValidator {
  validate(request: {
    workspace: string;
    projectId: string;
    generatedPaths: string[];
    scenarioIds: string[];
  }): Promise<{ status: 'passed' } | { status: 'failed'; error: string }>;
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
  try {
    return PlaywrightScenarioSchema.parse(JSON.parse(encoded));
  } catch {
    throw new Error('invalid qali-playwright scenario');
  }
}

function approvedScenarios(markdown: string): ApprovedScenario[] {
  const headings = [...markdown.matchAll(/^##\s+([A-Z][A-Z0-9-]+):[^\n]*$/gm)];
  const documentApproved = /^-\s*Status:\s*approved for automation\s*$/im.test(
    markdown.slice(0, headings[0]?.index ?? markdown.length)
  );
  return headings.flatMap((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const scenarioStatus = /^-\s*Status:\s*(.+)$/im.exec(body)?.[1]?.trim().toLowerCase();
    if (scenarioStatus ? scenarioStatus !== 'approved for automation' : !documentApproved)
      return [];
    const traceability = /^-\s*Traceability:\s*(.+)$/im.exec(body)?.[1] ?? '';
    const requirementIds = [...traceability.matchAll(/\bREQ-\d+\b/g)].map(([id]) => id);
    const playwright = playwrightScenario(body);
    return [
      {
        id: heading[1]!,
        requirementIds,
        source: 'approved' as const,
        ...(playwright ? { playwright } : {})
      }
    ];
  });
}

function journeyScenarios(markdown: string): ApprovedScenario[] {
  const headings = [...markdown.matchAll(/^##\s+(JRN-[A-Z0-9-]+):[^\n]*$/gm)];
  return headings.flatMap((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const traceability =
      /^-\s*Requirement links:\s*(.+)$/im.exec(body)?.[1] ??
      /^-\s*Traceability:\s*(.+)$/im.exec(body)?.[1] ??
      '';
    const requirementIds = [...traceability.matchAll(/\bREQ-\d+\b/g)].map(([id]) => id);
    const playwright = playwrightScenario(body);
    return [
      {
        id: heading[1]!,
        requirementIds,
        source: 'journey' as const,
        ...(playwright ? { playwright } : {})
      }
    ];
  });
}

function loadGenerationScenarios(projectRoot: string): ApprovedScenario[] {
  const approvedDirectory = join(projectRoot, 'derived/scenarios/approved');
  const approved = existsSync(approvedDirectory)
    ? readdirSync(approvedDirectory)
        .filter((name) => name.endsWith('.md'))
        .flatMap((name) => approvedScenarios(readFileSync(join(approvedDirectory, name), 'utf8')))
    : [];
  if (approved.length > 0) return approved;
  const journeysPath = join(projectRoot, 'sources/reference/journeys.md');
  if (!existsSync(journeysPath)) return [];
  return journeyScenarios(readFileSync(journeysPath, 'utf8'));
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
  command: NormalizedCommand,
  validator?: GeneratedTestValidator
) {
  const outputs = step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, command)
  }));
  const projectRoot = join(workspace, command.project.root);
  const scenarios = loadGenerationScenarios(projectRoot);
  if (step.id === 'generate-tests' && command.parameters.retractGeneratedTests === true) {
    const generatedDirectory = join(projectRoot, 'tests/generated');
    const requestId = generationRequestId(command);
    if (requestId && existsSync(generatedDirectory)) {
      for (const name of readdirSync(generatedDirectory)) {
        if (!name.endsWith('.generated.spec.ts')) continue;
        const path = join(generatedDirectory, name);
        if (specMatchesGenerationRequest(readFileSync(path, 'utf8'), requestId)) {
          unlinkSync(path);
        }
      }
    }
    return { status: 'succeeded' as const, outputs };
  }
  if (step.id === 'generate-tests') {
    const generatedScenarios = scenarios.filter(
      (scenario): scenario is ApprovedScenario & { playwright: PlaywrightScenario } =>
        Boolean(scenario.playwright)
    );
    const untraced = generatedScenarios.find((scenario) => scenario.requirementIds.length === 0);
    if (untraced) {
      throw new Error(`${untraced.id} is missing requirement traceability`);
    }
    const generatedDirectory = join(projectRoot, 'tests/generated');
    mkdirSync(generatedDirectory, { recursive: true });
    for (const name of readdirSync(generatedDirectory)) {
      if (name.endsWith('.generated.spec.ts')) unlinkSync(join(generatedDirectory, name));
    }
    const generatedPaths: string[] = [];
    const scenarioIds: string[] = [];
    for (const scenario of generatedScenarios) {
      const usesTestInfo = scenario.playwright.assertions.some(
        ({ kind }) => kind === 'evidenceScreenshot'
      );
      const usesExpect = scenario.playwright.assertions.some(
        ({ kind }) => kind !== 'evidenceScreenshot'
      );
      const usesNamedFills = scenario.playwright.actions.some(({ kind }) => kind === 'fillNamed');
      const usesTestData = scenario.playwright.actions.some(
        (action) => action.kind === 'fillNamed' && action.source === 'testData'
      );
      const usesCredentials = scenario.playwright.actions.some(
        (action) => action.kind === 'fillNamed' && action.source === 'credentials'
      );
      const lines = [
        `import { ${usesExpect ? 'expect, ' : ''}test } from '@playwright/test';`,
        '',
        `// ${scenario.source === 'journey' ? 'Generated from' : 'Approved scenario'}: ${scenario.id}`,
        `// Requirements: ${scenario.requirementIds.join(', ')}`,
        ...(generationRequestId(command)
          ? [`// Generation request: ${generationRequestId(command)}`]
          : []),
        `test(${quoted(`${scenario.id} generated scenario`)}, async ({ page }${usesTestInfo ? ', testInfo' : ''}) => {`,
        ...(usesNamedFills
          ? [
              ...(usesTestData
                ? [
                    "  const testData = JSON.parse(process.env.QALI_TEST_DATA_JSON ?? '{}') as Record<string, string>;"
                  ]
                : []),
              ...(usesCredentials
                ? [
                    "  const credentials = JSON.parse(process.env.QALI_TEST_CREDENTIALS_JSON ?? '{}') as Record<string, string>;"
                  ]
                : [])
            ]
          : []),
        `  await page.goto(${quoted(scenario.playwright.path)});`
      ];
      for (const action of scenario.playwright.actions) {
        if (action.kind === 'fill') {
          lines.push(
            `  await page.getByLabel(${quoted(action.label)}).fill(${quoted(action.value)});`
          );
        } else if (action.kind === 'fillNamed') {
          const locator =
            action.locator === 'placeholder'
              ? `page.getByPlaceholder(${quoted(action.name)})`
              : `page.getByLabel(${quoted(action.name)})`;
          const source = action.source === 'credentials' ? 'credentials' : 'testData';
          lines.push(`  await ${locator}.fill(String(${source}.${action.field} ?? ''));`);
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
        } else if (assertion.kind === 'roleText') {
          lines.push(
            `  await expect(page.getByRole(${quoted(assertion.role)})).toHaveText(${quoted(assertion.value)});`
          );
        } else if (assertion.kind === 'visual') {
          lines.push(`  await expect(page).toHaveScreenshot(${quoted(assertion.name)});`);
        } else if (assertion.kind === 'evidenceScreenshot') {
          lines.push(
            '  // Evidence-only screenshot; not a visual assertion.',
            `  await page.screenshot({ path: testInfo.outputPath(${quoted(assertion.name)}), fullPage: true });`
          );
        }
      }
      lines.push('});', '');
      const relativePath = `${command.project.root}/tests/generated/${scenario.id.toLowerCase()}.generated.spec.ts`;
      writeFileSync(
        join(workspace, relativePath),
        await format(lines.join('\n'), {
          parser: 'typescript',
          singleQuote: true,
          trailingComma: 'none',
          printWidth: 100
        })
      );
      generatedPaths.push(relativePath);
      scenarioIds.push(scenario.id);
    }
    if (!validator) {
      return { status: 'blocked' as const, reason: 'generated test validator is unavailable' };
    }
    const validation = await validator.validate({
      workspace,
      projectId: command.project.id,
      generatedPaths,
      scenarioIds
    });
    if (validation.status === 'failed') return validation;
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
      await format(
        [
          scenarios.every((scenario) => scenario.source === 'journey')
            ? '# Journey coverage'
            : '# Approved scenario coverage',
          '',
          '| Scenario | Requirement | Requirement status |',
          '| --- | --- | --- |',
          ...rows
        ].join('\n'),
        { parser: 'markdown', proseWrap: 'preserve' }
      )
    )
  );
  return { status: 'succeeded' as const, outputs };
}
