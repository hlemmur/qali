import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EvaluationSuiteSchema,
  type EvaluationSuite,
  type EvaluationSuiteCase
} from '@qali/contracts';
import { loadHarnessProfiles, harnessExecutionKind } from './harness-profiles.js';
import { assembleHarnessWorkspace } from './harness-workspace.js';
import { loadRuntimeSkillAssets } from './skill-assets.js';

export function parseEvaluationSuite(input: unknown): EvaluationSuite {
  return EvaluationSuiteSchema.parse(input);
}

export function loadEvaluationSuite(path: string): EvaluationSuite {
  return parseEvaluationSuite(JSON.parse(readFileSync(path, 'utf8')));
}

export interface EvaluationCaseResult {
  id: string;
  passed: boolean;
  detail: string;
}

function unlock(directory: string): void {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) unlock(path);
    else chmodSync(path, 0o600);
  }
}

function skillContent(repositoryRoot: string, skillId: string): string {
  const asset = loadRuntimeSkillAssets(join(repositoryRoot, 'skills/runtime')).find(
    (skill) => skill.id === skillId
  );
  if (!asset) throw new Error(`unknown skill ${skillId}`);
  return asset.content;
}

function assembleProfile(
  repositoryRoot: string,
  profileId: string,
  workspace: string
): ReturnType<typeof assembleHarnessWorkspace> {
  const profile = loadHarnessProfiles(
    join(repositoryRoot, 'harness/profiles.json'),
    join(repositoryRoot, 'skills/runtime')
  ).find((entry) => entry.id === profileId);
  if (!profile) throw new Error(`unknown harness profile ${profileId}`);
  const browser = profile.tools.includes('browser')
    ? {
        serviceScript: 'scripts/browser-facade-mcp.ts',
        environmentFile: join(tmpdir(), `qali-eval-browser-${profileId}.env`)
      }
    : undefined;
  if (browser) writeFileSync(browser.environmentFile, 'QALI_TARGET_BASE_URL=http://127.0.0.1/\n');
  return assembleHarnessWorkspace({
    sourceRoot: repositoryRoot,
    workspace,
    profile,
    inputFiles: [],
    ...(browser ? { browser } : {})
  });
}

function runHarnessAssertion(
  repositoryRoot: string,
  assertion: 'deny-shell' | 'browser-mcp-matches-profile'
): { passed: boolean; detail: string } {
  const profiles = loadHarnessProfiles(
    join(repositoryRoot, 'harness/profiles.json'),
    join(repositoryRoot, 'skills/runtime')
  ).filter((profile) => harnessExecutionKind(profile) === 'agent');
  const failures: string[] = [];
  for (const profile of profiles) {
    const workspace = mkdtempSync(join(tmpdir(), `qali-eval-${profile.id}-`));
    try {
      assembleProfile(repositoryRoot, profile.id, join(workspace, 'run'));
      const cli = JSON.parse(readFileSync(join(workspace, 'run/.cursor/cli.json'), 'utf8')) as {
        permissions?: { allow?: string[]; deny?: string[] };
      };
      const deny = cli.permissions?.deny ?? [];
      const allow = cli.permissions?.allow ?? [];
      if (assertion === 'deny-shell') {
        if (!deny.includes('Shell(*)')) {
          failures.push(`${profile.id} is missing Shell(*) deny`);
        }
        if (allow.some((entry) => /shell/i.test(entry))) {
          failures.push(`${profile.id} allows shell`);
        }
      }
      if (assertion === 'browser-mcp-matches-profile') {
        const mcpPath = join(workspace, 'run/.cursor/mcp.json');
        const allowsBrowser = allow.includes('Mcp(qali-browser:*)');
        let mcpExists = true;
        try {
          readFileSync(mcpPath, 'utf8');
        } catch {
          mcpExists = false;
        }
        const wantsBrowser = profile.tools.includes('browser');
        if (wantsBrowser && (!mcpExists || !allowsBrowser)) {
          failures.push(`${profile.id} should expose browser MCP`);
        }
        if (!wantsBrowser && (mcpExists || allowsBrowser)) {
          failures.push(`${profile.id} must not expose browser MCP`);
        }
      }
    } finally {
      unlock(workspace);
      rmSync(workspace, { recursive: true, force: true });
    }
  }
  return {
    passed: failures.length === 0,
    detail: failures.length === 0 ? 'passed' : failures.join('; ')
  };
}

export function runEvaluationCase(
  repositoryRoot: string,
  evaluationCase: EvaluationSuiteCase
): EvaluationCaseResult {
  if (evaluationCase.kind === 'skill-invariant') {
    const content = skillContent(repositoryRoot, evaluationCase.skillId!);
    const missing = (evaluationCase.mustInclude ?? []).filter(
      (needle) => !content.includes(needle)
    );
    return {
      id: evaluationCase.id,
      passed: missing.length === 0,
      detail:
        missing.length === 0
          ? 'passed'
          : `skill ${evaluationCase.skillId} missing ${missing.join(', ')}`
    };
  }
  const result = runHarnessAssertion(repositoryRoot, evaluationCase.assertion!);
  return { id: evaluationCase.id, ...result };
}

export function runEvaluationSuite(
  repositoryRoot: string,
  suite: EvaluationSuite
): { passed: boolean; results: EvaluationCaseResult[] } {
  const results = suite.cases.map((evaluationCase) =>
    runEvaluationCase(repositoryRoot, evaluationCase)
  );
  return { passed: results.every((result) => result.passed), results };
}
