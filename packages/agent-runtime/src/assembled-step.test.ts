import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedCommand, WorkflowStep } from '@qali/contracts';
import { FakeAgentRuntime } from './index.js';
import { loadHarnessProfiles } from './harness-profiles.js';
import { executeAssembledAgentStep, promoteHarnessOutputs } from './assembled-step.js';
import { ROLE_PROFILES } from '../../orchestrator/src/workflows.js';

const temporaryDirectories: string[] = [];
function unlock(directory: string): void {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) unlock(join(directory, entry.name));
    else chmodSync(join(directory, entry.name), 0o600);
  }
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    unlock(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

const command: NormalizedCommand = {
  intent: 'explore-project',
  project: { id: 'sample', root: 'projects/sample', environmentLabel: 'production' },
  requestedBy: 'U1',
  externalRole: 'qa-lead-admin',
  receivedAt: '2026-08-13T00:00:00.000Z',
  parameters: { feature: 'login flow' }
};

describe('assembled Cursor harness step', () => {
  it('copies validated staged outputs into the pack and never inlines skills as the only channel', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-assembled-'));
    temporaryDirectories.push(parent);
    const sourceRoot = join(parent, 'repo');
    mkdirSync(join(sourceRoot, 'projects/sample/sources'), { recursive: true });
    writeFileSync(join(sourceRoot, 'projects/sample/sources/project-context.md'), '# Context\n');
    for (const path of [
      'harness/profiles.json',
      'skills/runtime',
      'core/policies',
      'core/templates',
      'scripts/browser-facade-mcp.ts'
    ]) {
      const from = join(process.cwd(), path);
      const to = join(sourceRoot, path);
      mkdirSync(join(to, '..'), { recursive: true });
      const { cpSync } = await import('node:fs');
      cpSync(from, to, { recursive: true });
    }
    const profiles = loadHarnessProfiles(
      join(sourceRoot, 'harness/profiles.json'),
      join(sourceRoot, 'skills/runtime')
    );
    const profile = profiles.find((entry) => entry.id === 'exploration-charter')!;
    const step: WorkflowStep = {
      id: 'charter',
      role: 'explorer',
      harnessProfileId: 'exploration-charter',
      needs: [],
      inputs: [
        {
          artifact: 'project-context',
          path: 'projects/{projectId}/sources/project-context.md'
        }
      ],
      outputs: [
        { artifact: 'exploration', path: 'projects/{projectId}/observations/exploration.md' }
      ],
      requiredTools: ['file-read', 'file-write'],
      mutations: ['append-observation'],
      policyGates: [],
      retries: 0,
      timeoutMs: 120000
    };
    const agent = new FakeAgentRuntime([
      {
        status: 'succeeded',
        output: '{}',
        raw: {}
      }
    ]);
    agent.execute = async (request) => {
      mkdirSync(join(request.workspace, 'outputs/charters'), { recursive: true });
      writeFileSync(
        join(request.workspace, 'outputs/charters/exploration.md'),
        '## Exploration Charter\n\nFocus: login flow\n\nMethod: bounded black-box exploration through the restricted browser facade.\n'
      );
      return { status: 'succeeded', output: '{}' };
    };

    const result = await executeAssembledAgentStep({
      sourceRoot,
      workspace: join(parent, 'harness'),
      command,
      step,
      profile,
      role: ROLE_PROFILES.explorer,
      agent
    });

    expect(result.status).toBe('succeeded');
    expect(
      readFileSync(join(sourceRoot, 'projects/sample/observations/exploration.md'), 'utf8')
    ).toContain('Focus: login flow');
    expect(agent).toBeDefined();
  });

  it('promotes a coverage markdown file to the declared coverage-map.md path', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-assembled-'));
    temporaryDirectories.push(parent);
    const sourceRoot = join(parent, 'repo');
    mkdirSync(join(sourceRoot, 'projects/sample/derived/scenarios'), { recursive: true });
    for (const path of [
      'harness/profiles.json',
      'skills/runtime',
      'core/policies',
      'core/templates',
      'scripts/browser-facade-mcp.ts'
    ]) {
      const from = join(process.cwd(), path);
      const to = join(sourceRoot, path);
      mkdirSync(join(to, '..'), { recursive: true });
      const { cpSync } = await import('node:fs');
      cpSync(from, to, { recursive: true });
    }
    const profiles = loadHarnessProfiles(
      join(sourceRoot, 'harness/profiles.json'),
      join(sourceRoot, 'skills/runtime')
    );
    const profile = profiles.find((entry) => entry.id === 'coverage-design')!;
    const step: WorkflowStep = {
      id: 'design-coverage',
      role: 'test-architect',
      harnessProfileId: 'coverage-design',
      needs: [],
      inputs: [],
      outputs: [
        { artifact: 'scenarios', path: 'projects/{projectId}/derived/scenarios/coverage-map.md' }
      ],
      requiredTools: ['file-read', 'file-write'],
      mutations: ['format-document'],
      policyGates: [],
      retries: 0,
      timeoutMs: 180000
    };
    const agent = new FakeAgentRuntime([]);
    agent.execute = async (request) => {
      mkdirSync(join(request.workspace, 'outputs/coverage'), { recursive: true });
      writeFileSync(
        join(request.workspace, 'outputs/coverage/plan.md'),
        '| Scenario | Requirement |\n| --- | --- |\n| JRN-001 | REQ-001 |\n'
      );
      return { status: 'succeeded', output: '{}' };
    };

    const result = await executeAssembledAgentStep({
      sourceRoot,
      workspace: join(parent, 'harness'),
      command: { ...command, intent: 'generate-test-suite' },
      step,
      profile,
      role: ROLE_PROFILES['test-architect'],
      agent
    });

    expect(result.status).toBe('succeeded');
    expect(existsSync(join(sourceRoot, 'projects/sample/derived/scenarios/coverage-map.md'))).toBe(
      true
    );
    expect(
      readFileSync(join(sourceRoot, 'projects/sample/derived/scenarios/coverage-map.md'), 'utf8')
    ).toContain('JRN-001');
  });

  it('rewrites Playwright empty fixture patterns when promoting generated tests', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-assembled-'));
    temporaryDirectories.push(parent);
    const harnessWorkspace = join(parent, 'harness');
    const packRoot = join(parent, 'pack');
    mkdirSync(join(harnessWorkspace, 'outputs/tests/e2e/fixtures'), { recursive: true });
    writeFileSync(
      join(harnessWorkspace, 'outputs/tests/e2e/fixtures/login.fixture.ts'),
      `export const test = base.extend({
  lockedOutUser: async ({}, use) => {
    await use({ username: 'locked_out_user' });
  },
});
`
    );

    promoteHarnessOutputs({
      harnessWorkspace,
      packRoot,
      step: {
        id: 'generate-tests',
        role: 'test-generator',
        harnessProfileId: 'test-generation',
        needs: [],
        inputs: [],
        outputs: [],
        requiredTools: ['file-write'],
        mutations: ['create-test'],
        policyGates: [],
        retries: 0,
        timeoutMs: 180000
      }
    });

    const promoted = readFileSync(
      join(packRoot, 'tests/generated/e2e/fixtures/login.fixture.ts'),
      'utf8'
    );
    expect(promoted).not.toMatch(/async \(\{\s*\}, use\)/);
    expect(promoted).toContain('async (_fixtures, use)');
  });
});
