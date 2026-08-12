import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleHarnessWorkspace } from './harness-workspace.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function files(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return files(root, absolute);
    return [absolute.slice(root.length + 1)];
  });
}

describe('ephemeral harness workspace', () => {
  it('contains only explicitly selected inputs, skills, policies, templates, outputs, and browser MCP config', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-harness-'));
    temporaryDirectories.push(parent);
    const workspace = join(parent, 'run');

    const result = assembleHarnessWorkspace({
      sourceRoot: process.cwd(),
      workspace,
      profile: {
        id: 'exploration',
        skillIds: ['exploratory-testing', 'agentic-browser-testing'],
        policyPaths: [
          'core/policies/operating-model.md',
          'core/policies/evidence-and-provenance.md',
          'core/policies/authority-and-autonomy.md'
        ],
        templatePaths: ['core/templates/session-log.md'],
        writableOutputDirectories: ['outputs/observations', 'outputs/evidence'],
        tools: ['browser'],
        mutations: ['append-observation', 'append-evidence'],
        validators: ['session-log-schema']
      },
      inputFiles: [
        {
          source: 'projects/_demo/sources/project-context.md',
          destination: 'inputs/project-context.md'
        }
      ],
      browser: {
        serviceScript: 'scripts/browser-facade-mcp.ts',
        environmentFile: '/run/secrets/qali-browser.env'
      }
    });

    expect(files(workspace).sort()).toEqual([
      '.agents/skills/agentic-browser-testing/SKILL.md',
      '.agents/skills/exploratory-testing/SKILL.md',
      '.cursor/cli.json',
      '.cursor/mcp.json',
      '.cursor/rules/authority-and-autonomy.mdc',
      '.cursor/rules/evidence-and-provenance.mdc',
      '.cursor/rules/operating-model.mdc',
      'AGENTS.md',
      'harness-manifest.json',
      'inputs/project-context.md',
      'templates/session-log.md'
    ]);
    expect(existsSync(join(workspace, 'outputs/observations'))).toBe(true);
    expect(existsSync(join(workspace, 'outputs/evidence'))).toBe(true);
    expect(result.manifest.profileId).toBe('exploration');
    expect(result.manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(workspace, '.cursor/mcp.json'), 'utf8')).toContain(
      '/run/secrets/qali-browser.env'
    );
    expect(readFileSync(join(workspace, '.cursor/cli.json'), 'utf8')).toContain('Shell(*)');
    expect(existsSync(join(workspace, 'projects/_demo'))).toBe(false);
  });
});
