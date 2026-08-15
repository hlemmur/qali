import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';
import type { NormalizedCommand, RoleProfile, WorkflowStep } from '@qali/contracts';
import type { AgentRuntime } from './index.js';
import { assembleHarnessWorkspace, type HarnessProfile } from './harness-workspace.js';

const expand = (value: string, command: NormalizedCommand): string =>
  value.replaceAll('{projectId}', command.project.id);

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolute);
    if (entry.isSymbolicLink() || !lstatSync(absolute).isFile()) return [];
    return [absolute];
  });
}

function unlock(directory: string): void {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) unlock(path);
    else {
      try {
        chmodSync(path, 0o600);
      } catch {
        /* ignore */
      }
    }
  }
}

export function removeHarnessWorkspace(directory: string): void {
  unlock(directory);
  rmSync(directory, { recursive: true, force: true });
}

export function collectHarnessInputFiles(
  sourceRoot: string,
  step: WorkflowStep,
  command: NormalizedCommand
): Array<{ source: string; destination: string }> {
  const files: Array<{ source: string; destination: string }> = [];
  for (const input of step.inputs) {
    const source = expand(input.path, command);
    const absolute = join(sourceRoot, source);
    if (!existsSync(absolute)) continue;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are prohibited: ${source}`);
    if (stat.isFile()) {
      files.push({
        source,
        destination: `inputs/${input.artifact}/${source.split(/[\\/]/).at(-1)}`
      });
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const file of listFiles(absolute)) {
      const relativePath = relative(absolute, file).split(sep).join('/');
      files.push({
        source: relative(sourceRoot, file).split(sep).join('/'),
        destination: `inputs/${input.artifact}/${relativePath}`
      });
    }
  }
  return files;
}

function rewritePlaywrightEmptyFixturePatterns(source: string): string {
  return source.replace(/\(\s*\{\s*\}\s*,\s*use\b/g, '(_fixtures, use');
}

function isUnrunPlaywrightCall(node: ts.CallExpression): boolean {
  const names: string[] = [];
  let expression: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(expression)) {
    names.unshift(expression.name.text);
    expression = expression.expression;
  }
  if (ts.isIdentifier(expression)) names.unshift(expression.text);
  if (names[0] !== 'test' && names[0] !== 'describe') return false;
  return names.includes('skip') || names.includes('fixme');
}

function stripUnrunPlaywrightTests(source: string): string {
  const file = ts.createSourceFile(
    'generated.spec.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit = (node: ts.Node): ts.Node | undefined => {
      if (
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        isUnrunPlaywrightCall(node.expression)
      ) {
        return undefined;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (sourceFile) => ts.visitEachChild(sourceFile, visit, context);
  };
  const transformed = ts.transform(file, [transformer]).transformed[0];
  if (!transformed) return source;
  return ts.createPrinter().printFile(transformed);
}

function sanitizePromotedGeneratedTests(generatedDirectory: string): void {
  for (const file of listFiles(generatedDirectory)) {
    if (!file.endsWith('.ts')) continue;
    const before = readFileSync(file, 'utf8');
    let after = rewritePlaywrightEmptyFixturePatterns(before);
    if (file.endsWith('.spec.ts')) {
      after = stripUnrunPlaywrightTests(after);
    }
    if (after !== before) writeFileSync(file, after);
  }
}

function appendMarkdown(existing: string, addition: string): string {
  const separator =
    existing.length === 0
      ? ''
      : existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
          ? '\n'
          : '\n\n';
  return `${existing}${separator}${addition.trim()}\n`;
}

export function promoteHarnessOutputs(request: {
  harnessWorkspace: string;
  packRoot: string;
  step: WorkflowStep;
}): string[] {
  const promoted: string[] = [];
  const copyTree = (fromDir: string, toDir: string, mode: 'replace' | 'append-markdown') => {
    if (!existsSync(fromDir)) return;
    for (const file of listFiles(fromDir)) {
      const relativePath = relative(fromDir, file).split(sep).join('/');
      const destination = join(toDir, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      if (mode === 'append-markdown' && destination.endsWith('.md') && existsSync(destination)) {
        writeFileSync(
          destination,
          appendMarkdown(readFileSync(destination, 'utf8'), readFileSync(file, 'utf8'))
        );
      } else {
        cpSync(file, destination, { dereference: true });
      }
      promoted.push(destination);
    }
  };

  if (request.step.id === 'charter') {
    copyTree(
      join(request.harnessWorkspace, 'outputs/charters'),
      join(request.packRoot, 'observations'),
      'append-markdown'
    );
  } else if (request.step.id === 'explore') {
    copyTree(
      join(request.harnessWorkspace, 'outputs/observations'),
      join(request.packRoot, 'observations'),
      'append-markdown'
    );
    copyTree(
      join(request.harnessWorkspace, 'outputs/evidence'),
      join(request.packRoot, 'observations/evidence/exploration'),
      'replace'
    );
    copyTree(
      join(request.harnessWorkspace, 'outputs/scenarios'),
      join(request.packRoot, 'derived/scenarios/proposed'),
      'replace'
    );
  } else if (request.step.id === 'report') {
    copyTree(
      join(request.harnessWorkspace, 'outputs/reports'),
      join(request.packRoot, 'derived/reports'),
      'replace'
    );
  } else if (request.step.id === 'design-coverage') {
    copyTree(
      join(request.harnessWorkspace, 'outputs/coverage'),
      join(request.packRoot, 'derived/scenarios'),
      'replace'
    );
    copyTree(
      join(request.harnessWorkspace, 'outputs/scenarios'),
      join(request.packRoot, 'derived/scenarios/proposed'),
      'replace'
    );
    const coverageMap = join(request.packRoot, 'derived/scenarios/coverage-map.md');
    if (!existsSync(coverageMap)) {
      const coverageSource = listFiles(join(request.harnessWorkspace, 'outputs/coverage')).find(
        (file) => file.endsWith('.md')
      );
      if (coverageSource) {
        mkdirSync(dirname(coverageMap), { recursive: true });
        cpSync(coverageSource, coverageMap, { dereference: true });
        promoted.push(coverageMap);
      }
    }
  } else if (request.step.id === 'generate-tests') {
    copyTree(
      join(request.harnessWorkspace, 'outputs/tests'),
      join(request.packRoot, 'tests/generated'),
      'replace'
    );
    sanitizePromotedGeneratedTests(join(request.packRoot, 'tests/generated'));
  } else {
    copyTree(join(request.harnessWorkspace, 'outputs'), request.packRoot, 'replace');
  }
  return promoted;
}

export function agentReportedMissingBrowserMcp(text: string): boolean {
  return /mcp server does not exist/i.test(text);
}

export function harnessCapturedBrowserEvidence(harnessWorkspace: string): boolean {
  return listFiles(join(harnessWorkspace, 'outputs/evidence')).some((file) =>
    /\.(png|jpe?g|webp)$/i.test(file)
  );
}

function agentTranscript(result: { output?: string; error?: string; raw?: unknown }): string {
  return [result.output, result.error, typeof result.raw === 'string' ? result.raw : '']
    .filter(Boolean)
    .join('\n');
}

export async function executeAssembledAgentStep(request: {
  sourceRoot: string;
  workspace: string;
  command: NormalizedCommand;
  step: WorkflowStep;
  profile: HarnessProfile;
  role: RoleProfile;
  agent: AgentRuntime;
  browserEnvironmentFile?: string;
  signal?: AbortSignal;
}): Promise<
  | { status: 'succeeded'; outputs: Array<{ artifact: string; path: string }>; promoted: string[] }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; error: string }
> {
  const outputs = request.step.outputs.map(({ artifact, path }) => ({
    artifact,
    path: expand(path, request.command)
  }));
  const harnessWorkspace = request.workspace;
  assembleHarnessWorkspace({
    sourceRoot: request.sourceRoot,
    workspace: harnessWorkspace,
    profile: request.profile,
    inputFiles: collectHarnessInputFiles(request.sourceRoot, request.step, request.command),
    ...(request.profile.tools.includes('browser')
      ? {
          browser: {
            serviceScript: 'scripts/browser-facade-mcp.ts',
            environmentFile: request.browserEnvironmentFile ?? ''
          }
        }
      : {})
  });
  const result = await request.agent.execute({
    workspace: harnessWorkspace,
    role: request.role,
    step: request.step,
    skillInstructions:
      'Follow AGENTS.md and the selected skills under .agents/skills/. Write deliverables only under outputs/. Do not use shell. Do not write the source pack directly.',
    context: JSON.stringify({
      intent: request.command.intent,
      parameters: request.command.parameters,
      projectId: request.command.project.id,
      writableOutputDirectories: request.profile.writableOutputDirectories
    }),
    timeoutMs: request.step.timeoutMs,
    permissions: request.step.requiredTools,
    ...(request.signal ? { signal: request.signal } : {})
  });
  if (result.status === 'blocked') return { status: 'blocked', reason: result.output };
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  if (
    request.step.requiredTools.includes('browser') &&
    agentReportedMissingBrowserMcp(agentTranscript(result))
  ) {
    return {
      status: 'blocked',
      reason:
        'qali-browser MCP was not available; exploration cannot invent observations from sources'
    };
  }
  const promoted = promoteHarnessOutputs({
    harnessWorkspace,
    packRoot: join(request.sourceRoot, request.command.project.root),
    step: request.step
  });
  if (promoted.length === 0) {
    return { status: 'failed', error: 'agent produced no validated harness outputs' };
  }
  if (request.step.id === 'explore' && !harnessCapturedBrowserEvidence(harnessWorkspace)) {
    return {
      status: 'blocked',
      reason: 'exploration did not capture browser evidence'
    };
  }
  return { status: 'succeeded', outputs, promoted };
}
