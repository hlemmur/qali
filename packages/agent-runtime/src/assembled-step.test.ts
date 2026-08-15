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
import {
  executeAssembledAgentStep,
  promoteHarnessOutputs,
  agentReportedMissingBrowserMcp
} from './assembled-step.js';
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
  it('treats catalog-not-found wording as a missing qali-browser MCP', () => {
    expect(agentReportedMissingBrowserMcp('Error: MCP server "qali-browser" not found')).toBe(true);
    expect(agentReportedMissingBrowserMcp('qali-browser not listed')).toBe(true);
    expect(agentReportedMissingBrowserMcp('wrote session notes')).toBe(false);
  });

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

  it('keeps Playwright empty fixture destructuring when promoting generated tests', () => {
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
    expect(promoted).toContain('async ({}, use)');
    expect(promoted).not.toContain('_fixtures');
  });

  it('strips Playwright skip and fixme tests from promoted generated specs', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-assembled-'));
    temporaryDirectories.push(parent);
    const harnessWorkspace = join(parent, 'harness');
    const packRoot = join(parent, 'pack');
    mkdirSync(join(harnessWorkspace, 'outputs/tests'), { recursive: true });
    writeFileSync(
      join(harnessWorkspace, 'outputs/tests/login.spec.ts'),
      `import { test } from '@playwright/test';

test('named demo account reaches inventory after login @smoke', async ({ page }) => {
  await page.goto('/');
});

test.fixme('username whitespace handling pending GAP-004 confirmation', async () => {});
test.skip('legacy skipped case', async () => {});
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

    const promoted = readFileSync(join(packRoot, 'tests/generated/login.spec.ts'), 'utf8');
    expect(promoted).toContain('@smoke');
    expect(promoted).not.toMatch(/test\.(?:fixme|skip)\s*\(/);
  });

  it('flattens nested e2e/tests specs into tests/generated', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-assembled-'));
    temporaryDirectories.push(parent);
    const harnessWorkspace = join(parent, 'harness');
    const packRoot = join(parent, 'pack');
    mkdirSync(join(harnessWorkspace, 'outputs/tests/e2e/tests/auth'), { recursive: true });
    writeFileSync(
      join(harnessWorkspace, 'outputs/tests/e2e/tests/auth/login.spec.ts'),
      `import { test } from '@playwright/test';
test('signs in @smoke', async ({ page }) => {
  await page.goto('/');
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

    expect(existsSync(join(packRoot, 'tests/generated/e2e/tests/login.spec.ts'))).toBe(true);
    expect(existsSync(join(packRoot, 'tests/generated/e2e/tests/auth/login.spec.ts'))).toBe(false);
  });

  it('keeps an existing observation JSON charter and writes a new session file', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-assembled-'));
    temporaryDirectories.push(parent);
    const harnessWorkspace = join(parent, 'harness');
    const packRoot = join(parent, 'pack');
    mkdirSync(join(harnessWorkspace, 'outputs/observations'), { recursive: true });
    mkdirSync(join(packRoot, 'observations'), { recursive: true });
    writeFileSync(
      join(packRoot, 'observations/sauce-demo-login-flow-charter.json'),
      '{"session":"prior"}\n'
    );
    writeFileSync(
      join(harnessWorkspace, 'outputs/observations/sauce-demo-login-flow-charter.json'),
      '{"session":"current"}\n'
    );

    promoteHarnessOutputs({
      harnessWorkspace,
      packRoot,
      step: {
        id: 'explore',
        role: 'explorer',
        harnessProfileId: 'browser-exploration',
        needs: ['charter'],
        inputs: [],
        outputs: [],
        requiredTools: ['browser'],
        mutations: ['append-observation'],
        policyGates: [],
        retries: 0,
        timeoutMs: 180000
      }
    });

    expect(
      readFileSync(join(packRoot, 'observations/sauce-demo-login-flow-charter.json'), 'utf8')
    ).toBe('{"session":"prior"}\n');
    const extras = readdirSync(join(packRoot, 'observations')).filter(
      (name) => name !== 'sauce-demo-login-flow-charter.json'
    );
    expect(extras).toHaveLength(1);
    expect(readFileSync(join(packRoot, 'observations', extras[0]!), 'utf8')).toBe(
      '{"session":"current"}\n'
    );
  });

  it('blocks explore when the agent reports that qali-browser is missing', async () => {
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
      'scripts/browser-facade-mcp.ts',
      'scripts/qali-browser-mcp-launch.ts'
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
    const profile = profiles.find((entry) => entry.id === 'browser-exploration')!;
    const step: WorkflowStep = {
      id: 'explore',
      role: 'explorer',
      harnessProfileId: 'browser-exploration',
      needs: ['charter'],
      inputs: [],
      outputs: [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/exploration'
        }
      ],
      requiredTools: ['file-read', 'file-write', 'browser'],
      mutations: ['append-observation', 'append-evidence'],
      policyGates: [],
      retries: 0,
      timeoutMs: 3600000
    };
    const agent = new FakeAgentRuntime();
    agent.execute = async (request) => {
      mkdirSync(join(request.workspace, 'outputs/observations'), { recursive: true });
      writeFileSync(
        join(request.workspace, 'outputs/observations/exploration.md'),
        '## Notes\n\nRead sources only.\n'
      );
      return {
        status: 'succeeded',
        output: 'browser_navigate failed: MCP server does not exist: qali-browser'
      };
    };

    const result = await executeAssembledAgentStep({
      sourceRoot,
      workspace: join(parent, 'harness'),
      command,
      step,
      profile,
      role: ROLE_PROFILES.explorer,
      agent,
      browserEnvironmentFile: join(parent, 'browser.env')
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/qali-browser|browser evidence|MCP/i);
    }
  });

  it('blocks explore when the agent writes notes but captures no browser evidence', async () => {
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
      'scripts/browser-facade-mcp.ts',
      'scripts/qali-browser-mcp-launch.ts'
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
    const profile = profiles.find((entry) => entry.id === 'browser-exploration')!;
    const step: WorkflowStep = {
      id: 'explore',
      role: 'explorer',
      harnessProfileId: 'browser-exploration',
      needs: ['charter'],
      inputs: [],
      outputs: [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/exploration'
        }
      ],
      requiredTools: ['file-read', 'file-write', 'browser'],
      mutations: ['append-observation', 'append-evidence'],
      policyGates: [],
      retries: 0,
      timeoutMs: 3600000
    };
    const agent = new FakeAgentRuntime();
    agent.execute = async (request) => {
      mkdirSync(join(request.workspace, 'outputs/observations'), { recursive: true });
      writeFileSync(
        join(request.workspace, 'outputs/observations/exploration.md'),
        '## Notes\n\nInvented from sources.\n'
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
      agent,
      browserEnvironmentFile: join(parent, 'browser.env')
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/browser evidence/i);
    }
  });

  it('blocks explore when outputs/evidence only contains a stub json file', async () => {
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
      'scripts/browser-facade-mcp.ts',
      'scripts/qali-browser-mcp-launch.ts'
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
    const profile = profiles.find((entry) => entry.id === 'browser-exploration')!;
    const step: WorkflowStep = {
      id: 'explore',
      role: 'explorer',
      harnessProfileId: 'browser-exploration',
      needs: ['charter'],
      inputs: [],
      outputs: [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/exploration'
        }
      ],
      requiredTools: ['file-read', 'file-write', 'browser'],
      mutations: ['append-observation', 'append-evidence'],
      policyGates: [],
      retries: 0,
      timeoutMs: 3600000
    };
    const agent = new FakeAgentRuntime();
    agent.execute = async (request) => {
      mkdirSync(join(request.workspace, 'outputs/observations'), { recursive: true });
      mkdirSync(join(request.workspace, 'outputs/evidence'), { recursive: true });
      writeFileSync(
        join(request.workspace, 'outputs/observations/exploration.md'),
        '## Notes\n\nStubbed evidence index.\n'
      );
      writeFileSync(
        join(request.workspace, 'outputs/evidence/index.json'),
        JSON.stringify({ screenshots: [] })
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
      agent,
      browserEnvironmentFile: join(parent, 'browser.env')
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/browser evidence/i);
    }
  });

  it('succeeds explore when the browser MCP writes a screenshot under outputs/evidence', async () => {
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
      'scripts/browser-facade-mcp.ts',
      'scripts/qali-browser-mcp-launch.ts'
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
    const profile = profiles.find((entry) => entry.id === 'browser-exploration')!;
    const step: WorkflowStep = {
      id: 'explore',
      role: 'explorer',
      harnessProfileId: 'browser-exploration',
      needs: ['charter'],
      inputs: [],
      outputs: [
        {
          artifact: 'evidence',
          path: 'projects/{projectId}/observations/evidence/exploration'
        }
      ],
      requiredTools: ['file-read', 'file-write', 'browser'],
      mutations: ['append-observation', 'append-evidence'],
      policyGates: [],
      retries: 0,
      timeoutMs: 3600000
    };
    const agent = new FakeAgentRuntime();
    agent.execute = async (request) => {
      mkdirSync(join(request.workspace, 'outputs/observations'), { recursive: true });
      mkdirSync(join(request.workspace, 'outputs/evidence'), { recursive: true });
      writeFileSync(
        join(request.workspace, 'outputs/observations/exploration.md'),
        '## Session\n\nLogin form visible.\n'
      );
      writeFileSync(
        join(request.workspace, 'outputs/evidence/login.png'),
        Buffer.from([137, 80, 78, 71])
      );
      return { status: 'succeeded', output: 'used qali-browser' };
    };

    const result = await executeAssembledAgentStep({
      sourceRoot,
      workspace: join(parent, 'harness'),
      command,
      step,
      profile,
      role: ROLE_PROFILES.explorer,
      agent,
      browserEnvironmentFile: join(parent, 'browser.env')
    });

    expect(result.status).toBe('succeeded');
    expect(
      existsSync(join(sourceRoot, 'projects/sample/observations/evidence/exploration/login.png'))
    ).toBe(true);
  });
});
