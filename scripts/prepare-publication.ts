import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  SemanticPublicationManifestSchema,
  type PublicationCheckResult,
  type SemanticPublicationManifest
} from '../packages/contracts/src/index.js';
import {
  classifyPublicationPath,
  createSemanticPublicationChange
} from '../packages/publication/src/index.js';

export interface PublicationCheckCommand {
  command: string;
  args: string[];
}

export interface PreparePublicationOptions {
  workspace: string;
  requestId: string;
  projectRoot: string;
  provenanceRef?: string;
  authorityRef?: string;
  checks: PublicationCheckCommand[];
}

const lines = (value: string): string[] => value.split('\n').filter(Boolean);

const gitOutput = (workspace: string, args: string[]): string =>
  execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });

function beforeContent(workspace: string, path: string): string | null {
  const result = spawnSync('git', ['show', `HEAD:${path}`], {
    cwd: workspace,
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout : null;
}

function changedPaths(workspace: string, projectRoot: string): string[] {
  const tracked = lines(
    gitOutput(workspace, [
      'diff',
      '--name-only',
      '--diff-filter=ACDMRTUXB',
      'HEAD',
      '--',
      projectRoot
    ])
  );
  const untracked = lines(
    gitOutput(workspace, ['ls-files', '--others', '--exclude-standard', '--', projectRoot])
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

function executeCheck(workspace: string, check: PublicationCheckCommand): PublicationCheckResult {
  const started = performance.now();
  const result = spawnSync(check.command, check.args, {
    cwd: workspace,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    command: check.command,
    args: check.args,
    exitCode: result.status ?? -1,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout ?? '',
    stderr: result.stderr || (result.error ? String(result.error) : '')
  };
}

function approvedScenarioRef(
  workspace: string,
  projectRoot: string,
  content: string
): string | undefined {
  const scenarioId = /^\/\/ Approved scenario: (\S+)$/m.exec(content)?.[1];
  if (!scenarioId) return undefined;
  const directory = `${projectRoot}/derived/scenarios/approved`;
  try {
    const paths = lines(
      gitOutput(workspace, [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        directory
      ])
    );
    const match = paths.find((path) =>
      readFileSync(resolve(workspace, path), 'utf8').includes(scenarioId)
    );
    return match ? match.slice(`${projectRoot}/`.length) : undefined;
  } catch {
    return undefined;
  }
}

export function preparePublicationManifest(
  options: PreparePublicationOptions
): SemanticPublicationManifest {
  const checks = options.checks.map((check) => executeCheck(options.workspace, check));
  const changes = changedPaths(options.workspace, options.projectRoot)
    .filter((path) => classifyPublicationPath(path) !== 'raw-evidence')
    .map((path) => {
      const absolutePath = resolve(options.workspace, path);
      const after = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
      const approvedScenario =
        after && classifyPublicationPath(path) === 'test'
          ? approvedScenarioRef(options.workspace, options.projectRoot, after)
          : undefined;
      return createSemanticPublicationChange({
        path,
        before: beforeContent(options.workspace, path),
        after,
        ...(options.provenanceRef ? { provenanceRef: options.provenanceRef } : {}),
        ...(options.authorityRef ? { authorityRef: options.authorityRef } : {}),
        ...(approvedScenario ? { approvedScenarioRef: approvedScenario } : {})
      });
    });
  return SemanticPublicationManifestSchema.parse({
    version: 1,
    requestId: options.requestId,
    projectRoot: options.projectRoot,
    baseBranch: 'main',
    reviewOnly: true,
    title: `Qali generated changes for ${options.requestId}`,
    commitMessage: `Publish governed Qali changes for ${options.requestId}`,
    checks,
    changes
  });
}

const isDirect =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  const workspace = process.cwd();
  const projectJson = JSON.parse(process.env.PROJECT_JSON ?? '{}') as { root?: unknown };
  if (typeof projectJson.root !== 'string') {
    throw new Error('PROJECT_JSON with a trusted project root is required for publication');
  }
  const manifest = preparePublicationManifest({
    workspace,
    requestId: process.env.QALI_REQUEST_ID ?? 'local',
    projectRoot: projectJson.root,
    provenanceRef:
      process.env.QALI_PROVENANCE_REF ?? `workflow:${process.env.QALI_REQUEST_ID ?? 'local'}`,
    ...(process.env.QALI_AUTHORITY_REF ? { authorityRef: process.env.QALI_AUTHORITY_REF } : {}),
    checks: [
      { command: 'npm', args: ['run', 'format:check'] },
      { command: 'npm', args: ['run', 'lint'] },
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npm', args: ['run', 'project:validate', '--', projectJson.root] }
    ]
  });
  const output = process.env.QALI_PUBLICATION_MANIFEST ?? '.qali/publication-request.json';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.checks.some((check) => check.exitCode !== 0)) process.exitCode = 1;
}
