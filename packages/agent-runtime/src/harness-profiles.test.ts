import { existsSync, mkdtempSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHarnessProfiles } from './harness-profiles.js';
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
  'failure-explanation',
  'reproduction',
  'knowledge-reconciliation',
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
});
