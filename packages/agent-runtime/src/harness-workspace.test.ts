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
import { assembleHarnessWorkspace } from './harness-workspace.js';

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

    expect(files(workspace).sort()).toEqual(
      [
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
        'mcp.json',
        'templates/session-log.md'
      ].sort()
    );
    expect(existsSync(join(workspace, 'outputs/observations'))).toBe(true);
    expect(existsSync(join(workspace, 'outputs/evidence'))).toBe(true);
    expect(result.manifest.profileId).toBe('exploration');
    expect(result.manifest.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const mcp = JSON.parse(readFileSync(join(workspace, '.cursor/mcp.json'), 'utf8')) as {
      mcpServers: { 'qali-browser': { command: string; args: string[]; envFile?: string } };
    };
    expect(mcp.mcpServers['qali-browser'].envFile).toBeUndefined();
    expect(mcp.mcpServers['qali-browser'].args).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/qali-browser-mcp-launch\.ts$/),
        '/run/secrets/qali-browser.env',
        expect.stringMatching(/browser-facade-mcp\.ts$/)
      ])
    );
    expect(readFileSync(join(workspace, 'mcp.json'), 'utf8')).toBe(
      readFileSync(join(workspace, '.cursor/mcp.json'), 'utf8')
    );
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toContain('qali-browser');
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toContain(
      'do not invent observations from sources alone'
    );
    expect(readFileSync(join(workspace, '.cursor/cli.json'), 'utf8')).toContain('Shell(*)');
    expect(existsSync(join(workspace, 'projects/_demo'))).toBe(false);
    expect(() => writeFileSync(join(workspace, 'inputs/project-context.md'), 'tamper')).toThrow();
    expect(() => writeFileSync(join(workspace, 'AGENTS.md'), 'tamper')).toThrow();
    expect(() => writeFileSync(join(workspace, 'inputs/new.md'), 'tamper')).toThrow();
    expect(() =>
      writeFileSync(join(workspace, 'outputs/observations/result.md'), 'allowed')
    ).not.toThrow();
  });

  it('rejects traversal, symlinks, unknown skills, and browser profiles without service config', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-harness-deny-'));
    temporaryDirectories.push(parent);
    const base = {
      sourceRoot: process.cwd(),
      profile: {
        id: 'deny-test',
        skillIds: ['qa-start'],
        policyPaths: ['core/policies/operating-model.md'],
        templatePaths: ['core/templates/task.md'],
        writableOutputDirectories: ['outputs/result'],
        tools: [] as Array<'browser'>,
        mutations: [],
        validators: []
      },
      inputFiles: []
    };

    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'traversal'),
        inputFiles: [
          { source: 'projects/_demo/sources/project-context.md', destination: '../escape.md' }
        ]
      })
    ).toThrow('safe relative path');
    expect(existsSync(join(parent, 'escape.md'))).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'reserved-input'),
        inputFiles: [
          {
            source: 'projects/_demo/sources/project-context.md',
            destination: '.agents/skills/qa-start/SKILL.md'
          }
        ]
      })
    ).toThrow('input destination must be under inputs/');
    expect(existsSync(join(parent, 'reserved-input'))).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'unknown'),
        profile: { ...base.profile, skillIds: ['missing-skill'] }
      })
    ).toThrow('Unknown or unreviewed runtime skill');
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'unsafe-output'),
        profile: { ...base.profile, writableOutputDirectories: ['.cursor'] }
      })
    ).toThrow('unsafe writable output directory');
    expect(existsSync(join(parent, 'unsafe-output'))).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'invalid-mutation'),
        profile: { ...base.profile, mutations: ['invent-authority'] }
      })
    ).toThrow('Invalid harness mutation');
    expect(existsSync(join(parent, 'invalid-mutation'))).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'invalid-validator'),
        profile: { ...base.profile, validators: ['Run Arbitrary Validator'] }
      })
    ).toThrow('Invalid harness validator');
    expect(existsSync(join(parent, 'invalid-validator'))).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'invalid-tool'),
        profile: { ...base.profile, tools: ['shell' as 'browser'] }
      })
    ).toThrow('Invalid harness tool');
    expect(existsSync(join(parent, 'invalid-tool'))).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'relative-browser-env'),
        profile: { ...base.profile, tools: ['browser'] },
        browser: {
          serviceScript: 'scripts/browser-facade-mcp.ts',
          environmentFile: 'browser.env'
        }
      })
    ).toThrow('browser environment file must be an absolute host path');
    expect(existsSync(join(parent, 'relative-browser-env'))).toBe(false);
    const insideWorkspace = join(parent, 'inside-browser-env');
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: insideWorkspace,
        profile: { ...base.profile, tools: ['browser'] },
        browser: {
          serviceScript: 'scripts/browser-facade-mcp.ts',
          environmentFile: join(insideWorkspace, 'browser.env')
        }
      })
    ).toThrow('browser environment file must be outside the harness workspace');
    expect(existsSync(insideWorkspace)).toBe(false);
    expect(() =>
      assembleHarnessWorkspace({
        ...base,
        workspace: join(parent, 'browser'),
        profile: { ...base.profile, tools: ['browser'] }
      })
    ).toThrow('Browser tool requires MCP configuration');
  });

  it('changes the manifest fingerprint when a permission-affecting profile field changes', () => {
    const parent = mkdtempSync(join(tmpdir(), 'qali-harness-fingerprint-'));
    temporaryDirectories.push(parent);
    const profile = {
      id: 'reporting',
      skillIds: ['qa-report-humanizer'],
      policyPaths: ['core/policies/operating-model.md'],
      templatePaths: ['core/templates/task.md'],
      writableOutputDirectories: ['outputs/report'],
      tools: [] as Array<'browser'>,
      mutations: ['render-derived-report'],
      validators: ['report-schema']
    };
    const first = assembleHarnessWorkspace({
      sourceRoot: process.cwd(),
      workspace: join(parent, 'first'),
      profile,
      inputFiles: []
    });
    const variants = [
      { ...profile, skillIds: ['test-planning'] },
      {
        ...profile,
        policyPaths: [...profile.policyPaths, 'core/policies/evidence-and-provenance.md']
      },
      { ...profile, templatePaths: ['core/templates/job.md'] },
      { ...profile, writableOutputDirectories: ['outputs/alternate'] },
      { ...profile, mutations: [...profile.mutations, 'format-document'] },
      { ...profile, validators: [...profile.validators, 'markdown-links'] }
    ];
    const fingerprints = variants.map(
      (variant, index) =>
        assembleHarnessWorkspace({
          sourceRoot: process.cwd(),
          workspace: join(parent, `variant-${index}`),
          profile: variant,
          inputFiles: []
        }).manifest.fingerprint
    );

    expect(new Set([first.manifest.fingerprint, ...fingerprints])).toHaveLength(
      fingerprints.length + 1
    );
    expect(existsSync(join(first.workspace, '.cursor/mcp.json'))).toBe(false);
  });
});
