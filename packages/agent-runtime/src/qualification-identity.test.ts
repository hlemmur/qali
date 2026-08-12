import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeRuntimeQualificationIdentity } from './qualification-identity.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'qali-qualification-'));
  temporaryDirectories.push(root);
  const files: Record<string, string> = {
    'harness/profiles.json': '{"version":1,"profiles":[]}',
    'skills/runtime/example/SKILL.md': '# Skill\n',
    'core/policies/operating-model.md': '# Policy\n',
    'core/templates/report.md': '# Template\n',
    'packages/browser-facade/src/index.ts': 'export const browser = true;\n',
    'scripts/browser-facade-mcp.ts': 'export {};\n',
    'workflows/example.yaml': 'version: 1\n',
    'packages/orchestrator/src/workflows.ts': 'export const permissions = [];\n',
    'qualification/evaluation-suite.json': '{"version":1,"cases":[]}'
  };
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

describe('runtime qualification identity', () => {
  it('changes the qualification identity when a reviewed skill changes', () => {
    const root = fixture();
    const before = computeRuntimeQualificationIdentity({
      repositoryRoot: root,
      cursorCliVersion: '1.7.2',
      modelIdentifier: 'composer-2.5'
    });

    writeFileSync(join(root, 'skills/runtime/example/SKILL.md'), '# Changed skill\n');
    const after = computeRuntimeQualificationIdentity({
      repositoryRoot: root,
      cursorCliVersion: '1.7.2',
      modelIdentifier: 'composer-2.5'
    });

    expect(before.skillHash).not.toBe(after.skillHash);
    expect(before.harnessVersion).toBe('1');
    expect(before.modelIdentifier).toBe('composer-2.5');
  });

  it.each([
    ['skillHash', 'skills/runtime/example/SKILL.md', '# Changed skill\n'],
    ['ruleHash', 'core/policies/operating-model.md', '# Changed policy\n'],
    ['templateHash', 'core/templates/report.md', '# Changed template\n'],
    [
      'browserFacadeHash',
      'packages/browser-facade/src/index.ts',
      'export const browser = false;\n'
    ],
    ['permissionHash', 'workflows/example.yaml', 'version: 1\npermissions: changed\n'],
    ['evaluationSuiteHash', 'qualification/evaluation-suite.json', '{"version":1,"cases":[1]}']
  ] as const)('changes %s when its reviewed inputs change', (field, path, content) => {
    const root = fixture();
    const request = {
      repositoryRoot: root,
      cursorCliVersion: '1.7.2',
      modelIdentifier: 'composer-2.5'
    };
    const before = computeRuntimeQualificationIdentity(request);

    writeFileSync(join(root, path), content);
    const after = computeRuntimeQualificationIdentity(request);

    expect(before[field]).not.toBe(after[field]);
  });

  it('changes when the Cursor CLI or model identity changes', () => {
    const root = fixture();
    const before = computeRuntimeQualificationIdentity({
      repositoryRoot: root,
      cursorCliVersion: '1.7.2',
      modelIdentifier: 'composer-2.5'
    });

    expect(
      computeRuntimeQualificationIdentity({
        repositoryRoot: root,
        cursorCliVersion: '1.7.3',
        modelIdentifier: 'composer-2.5'
      }).cursorCliVersion
    ).not.toBe(before.cursorCliVersion);
    expect(
      computeRuntimeQualificationIdentity({
        repositoryRoot: root,
        cursorCliVersion: '1.7.2',
        modelIdentifier: 'other-model'
      }).modelIdentifier
    ).not.toBe(before.modelIdentifier);
  });
});
