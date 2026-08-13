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
import { afterEach, describe, expect, it } from 'vitest';
import {
  harnessExecutionKind,
  loadHarnessProfiles,
  selectHarnessProfile
} from './harness-profiles.js';
import { assembleHarnessWorkspace } from './harness-workspace.js';

const expectedIds = [
  'onboarding-discovery',
  'journey-discovery',
  'risk-assessment',
  'strategy-initial-plan',
  'exploration-charter',
  'browser-exploration',
  'coverage-design',
  'test-generation',
  'visual-test-generation',
  'host-test-execution',
  'host-failure-fingerprinting',
  'host-regression-validation',
  'failure-explanation',
  'reproduction',
  'knowledge-reconciliation',
  'knowledge-reconciliation-journey',
  'host-knowledge-reconciliation',
  'reliability-diagnosis',
  'selector-repair',
  'human-reporting'
];

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

describe('harness profile catalog', () => {
  it('selects visual test generation only from a typed visual request', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');

    expect(selectHarnessProfile(profiles, 'test-generation', { visualTesting: false }).id).toBe(
      'test-generation'
    );
    expect(selectHarnessProfile(profiles, 'test-generation', { visualTesting: true }).id).toBe(
      'visual-test-generation'
    );
  });

  it('binds deterministic Playwright execution to a host-only profile without agent skills', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');
    const profile = profiles.find(({ id }) => id === 'host-test-execution');

    expect(profile).toMatchObject({ kind: 'host', skillIds: [] });
    expect(harnessExecutionKind(profile!)).toBe('host');

    const agentProfile = profiles.find(({ id }) => id === 'browser-exploration')!;
    expect(harnessExecutionKind(agentProfile)).toBe('agent');
  });

  it('binds failure fingerprinting to a host-only profile before agent explanation', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');
    const profile = profiles.find(({ id }) => id === 'host-failure-fingerprinting');

    expect(profile).toMatchObject({
      kind: 'host',
      skillIds: [],
      writableOutputDirectories: ['outputs/evidence']
    });
    expect(harnessExecutionKind(profile!)).toBe('host');
  });

  it('binds regression red-state validation to a host-only profile', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');
    const profile = profiles.find(({ id }) => id === 'host-regression-validation');

    expect(profile).toMatchObject({ kind: 'host', skillIds: [] });
    expect(harnessExecutionKind(profile!)).toBe('host');
  });

  it('adds journey mapping to reconciliation only for a typed journey change', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');

    const reconciliation = selectHarnessProfile(profiles, 'knowledge-reconciliation', {
      visualTesting: false,
      journeyChange: false
    });
    const journeyReconciliation = selectHarnessProfile(profiles, 'knowledge-reconciliation', {
      visualTesting: false,
      journeyChange: true
    });

    expect(reconciliation.skillIds).toEqual(['qa-project-context']);
    expect(journeyReconciliation.skillIds).toEqual(['qa-project-context', 'journey-mapping']);
    expect(reconciliation.writableOutputDirectories).toEqual(['outputs/evidence']);
    expect(journeyReconciliation.writableOutputDirectories).toEqual(['outputs/evidence']);
  });

  it('rejects conditional profiles that widen tools, mutations, outputs, or policies', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');
    const visual = profiles.find(({ id }) => id === 'visual-test-generation')!;
    const widened = profiles.map((profile) =>
      profile.id === visual.id ? { ...profile, tools: ['browser'] as Array<'browser'> } : profile
    );

    expect(() => selectHarnessProfile(widened, 'test-generation', { visualTesting: true })).toThrow(
      'conditional harness profile widens authority'
    );
  });

  it('assembles the exact selected skills and browser configuration for every profile', () => {
    const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');
    expect(profiles.map(({ id }) => id)).toEqual(expectedIds);
    const parent = mkdtempSync(join(tmpdir(), 'qali-all-harnesses-'));
    temporaryDirectories.push(parent);

    for (const profile of profiles) {
      const result = assembleHarnessWorkspace({
        sourceRoot: process.cwd(),
        workspace: join(parent, profile.id),
        profile,
        inputFiles: [],
        ...(profile.tools.includes('browser')
          ? {
              browser: {
                serviceScript: 'scripts/browser-facade-mcp.ts',
                environmentFile: '/run/secrets/qali-browser.env'
              }
            }
          : {})
      });
      const expectedFiles = [
        'AGENTS.md',
        'harness-manifest.json',
        '.cursor/cli.json',
        ...profile.skillIds.map((id) => `.agents/skills/${id}/SKILL.md`),
        ...profile.policyPaths.map(
          (path) => `.cursor/rules/${path.split('/').at(-1)!.replace(/\.md$/, '')}.mdc`
        ),
        ...profile.templatePaths.map((path) => `templates/${path.split('/').at(-1)!}`),
        ...(profile.tools.includes('browser') ? ['.cursor/mcp.json'] : [])
      ].sort();
      const actualFiles = (function list(directory: string): string[] {
        return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
          const absolute = join(directory, entry.name);
          return entry.isDirectory()
            ? list(absolute)
            : [absolute.slice(result.workspace.length + 1)];
        });
      })(result.workspace).sort();
      expect(actualFiles).toEqual(expectedFiles);
      expect(existsSync(join(result.workspace, '.cursor/mcp.json'))).toBe(
        profile.tools.includes('browser')
      );
      expect(profile.policyPaths).toEqual(
        expect.arrayContaining([
          'core/policies/operating-model.md',
          'core/policies/evidence-and-provenance.md',
          'core/policies/authority-and-autonomy.md'
        ])
      );
    }
  });

  it('rejects excessive tools, unreviewed skills, unsafe outputs, and duplicate profile ids', () => {
    expect(() =>
      loadHarnessProfiles('harness/invalid-profiles.fixture.json', 'skills/runtime')
    ).toThrow();
  });

  it('rejects unknown mutation classes in the profile catalog', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-invalid-mutation-'));
    temporaryDirectories.push(parent);
    const catalog = JSON.parse(readFileSync('harness/profiles.json', 'utf8')) as {
      profiles: Array<{ mutations: string[] }>;
    };
    catalog.profiles[0]!.mutations = ['invent-authority'];
    const path = join(parent, 'profiles.json');
    writeFileSync(path, JSON.stringify(catalog));

    expect(() => loadHarnessProfiles(path, 'skills/runtime')).toThrow('Invalid mutation class');
  });

  it('rejects malformed validator ids in the profile catalog', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-invalid-validator-'));
    temporaryDirectories.push(parent);
    const catalog = JSON.parse(readFileSync('harness/profiles.json', 'utf8')) as {
      profiles: Array<{ validators: string[] }>;
    };
    catalog.profiles[0]!.validators = ['Run Arbitrary Validator'];
    const path = join(parent, 'profiles.json');
    writeFileSync(path, JSON.stringify(catalog));

    expect(() => loadHarnessProfiles(path, 'skills/runtime')).toThrow('Invalid validator id');
  });
});
