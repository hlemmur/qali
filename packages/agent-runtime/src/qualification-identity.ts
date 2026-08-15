import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { RuntimeQualificationIdentity } from './qualification.js';

function filesUnder(path: string): string[] {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`qualification inputs cannot be symlinks: ${path}`);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) throw new Error(`invalid qualification input: ${path}`);
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => filesUnder(join(path, entry.name)));
}

function hashInputs(repositoryRoot: string, paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of paths) {
    const absolute = join(repositoryRoot, path);
    if (!existsSync(absolute)) throw new Error(`missing qualification input: ${path}`);
    for (const file of filesUnder(absolute)) {
      hash.update(relative(repositoryRoot, file));
      hash.update('\0');
      hash.update(readFileSync(file));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

export function computeRuntimeQualificationIdentity(request: {
  repositoryRoot: string;
  cursorCliVersion: string;
  modelIdentifier: string;
}): RuntimeQualificationIdentity {
  const harnessCatalog = JSON.parse(
    readFileSync(join(request.repositoryRoot, 'harness/profiles.json'), 'utf8')
  ) as { version?: unknown };
  if (typeof harnessCatalog.version !== 'number' && typeof harnessCatalog.version !== 'string') {
    throw new Error('harness catalog version is required for qualification');
  }
  return {
    cursorCliVersion: request.cursorCliVersion,
    modelIdentifier: request.modelIdentifier,
    harnessVersion: String(harnessCatalog.version),
    harnessHash: hashInputs(request.repositoryRoot, ['harness/profiles.json']),
    skillHash: hashInputs(request.repositoryRoot, ['skills/runtime']),
    ruleHash: hashInputs(request.repositoryRoot, ['core/policies']),
    templateHash: hashInputs(request.repositoryRoot, ['core/templates']),
    browserFacadeHash: hashInputs(request.repositoryRoot, [
      'packages/browser-facade/src',
      'scripts/browser-facade-mcp.ts',
      'scripts/qali-browser-mcp-launch.ts'
    ]),
    permissionHash: hashInputs(request.repositoryRoot, [
      'harness/profiles.json',
      'packages/agent-runtime/src/index.ts',
      'packages/agent-runtime/src/qualification.ts',
      'packages/orchestrator/src/workflows.ts',
      'scripts/execute.ts',
      'workflows'
    ]),
    evaluationSuiteHash: hashInputs(request.repositoryRoot, ['qualification/evaluation-suite.json'])
  };
}
