import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePublicationManifest, authorityRefFromCommand } from './prepare-publication.js';
import { assessSemanticPublication } from '../packages/publication/src/index.js';

const git = (workspace: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });

describe('publication preparation', () => {
  it('captures host-computed before/after semantics and real check results', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-publication-'));
    const observationPath = 'projects/shop/observations/exploration.md';
    mkdirSync(join(workspace, 'projects/shop/observations'), { recursive: true });
    writeFileSync(join(workspace, observationPath), '# Observations\n');
    git(workspace, 'init');
    git(workspace, 'config', 'user.name', 'Test');
    git(workspace, 'config', 'user.email', 'test@example.test');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'baseline');
    writeFileSync(
      join(workspace, observationPath),
      '# Observations\n\n- Checkout failed (evidence: run-42).\n'
    );

    const manifest = preparePublicationManifest({
      workspace,
      requestId: 'REQ-42',
      projectRoot: 'projects/shop',
      provenanceRef: 'run:42',
      checks: [
        {
          command: process.execPath,
          args: ['-e', "process.stdout.write('semantic check passed')"]
        }
      ]
    });

    expect(manifest.reviewOnly).toBe(false);
    expect(
      preparePublicationManifest({
        workspace,
        requestId: 'REQ-42',
        projectRoot: 'projects/shop',
        provenanceRef: 'run:42',
        reviewOnly: true,
        checks: [
          {
            command: process.execPath,
            args: ['-e', "process.stdout.write('semantic check passed')"]
          }
        ]
      }).reviewOnly
    ).toBe(true);
    expect(manifest.checks).toEqual([
      expect.objectContaining({ exitCode: 0, stdout: 'semantic check passed', stderr: '' })
    ]);
    expect(manifest.changes).toEqual([
      expect.objectContaining({
        path: observationPath,
        classification: 'observation',
        before: expect.objectContaining({ content: '# Observations\n' }),
        after: expect.objectContaining({
          content: readFileSync(join(workspace, observationPath), 'utf8')
        }),
        provenanceRef: 'run:42'
      })
    ]);
  });

  it('fails closed with the actual exit code and excludes raw evidence from Git changes', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-publication-failure-'));
    mkdirSync(join(workspace, 'projects/shop/observations/evidence/run-42'), { recursive: true });
    mkdirSync(join(workspace, 'projects/shop/derived/reports'), { recursive: true });
    writeFileSync(join(workspace, 'projects/shop/derived/reports/.generated.md'), 'baseline\n');
    git(workspace, 'init');
    git(workspace, 'config', 'user.name', 'Test');
    git(workspace, 'config', 'user.email', 'test@example.test');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'baseline');
    writeFileSync(
      join(workspace, 'projects/shop/observations/evidence/run-42/trace.zip'),
      'raw trace'
    );
    writeFileSync(join(workspace, 'projects/shop/derived/reports/run-42.log'), 'raw browser log');
    writeFileSync(join(workspace, 'projects/shop/derived/reports/report.md'), 'not generated');

    const manifest = preparePublicationManifest({
      workspace,
      requestId: 'REQ-FAIL',
      projectRoot: 'projects/shop',
      checks: [
        {
          command: process.execPath,
          args: ['-e', "process.stderr.write('validator failed'); process.exit(7)"]
        }
      ]
    });

    expect(manifest.checks[0]).toMatchObject({ exitCode: 7, stderr: 'validator failed' });
    expect(manifest.changes.map(({ path }) => path)).toEqual([
      'projects/shop/derived/reports/report.md'
    ]);
  });

  it('classifies retract of a generated spec as a publishable deletion', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-publication-retract-'));
    const specPath = 'projects/shop/tests/generated/foo.generated.spec.ts';
    mkdirSync(join(workspace, 'projects/shop/tests/generated'), { recursive: true });
    writeFileSync(
      join(workspace, specPath),
      "test('generated', async ({ page }) => { await expect(page).toHaveURL('/'); });\n"
    );
    git(workspace, 'init');
    git(workspace, 'config', 'user.name', 'Test');
    git(workspace, 'config', 'user.email', 'test@example.test');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'baseline');
    unlinkSync(join(workspace, specPath));

    const manifest = preparePublicationManifest({
      workspace,
      requestId: 'REQ-RETRACT',
      projectRoot: 'projects/shop',
      checks: [
        {
          command: process.execPath,
          args: ['-e', "process.stdout.write('ok')"]
        }
      ]
    });

    expect(manifest.changes).toEqual([
      expect.objectContaining({
        path: specPath,
        classification: 'test',
        before: expect.objectContaining({
          content:
            "test('generated', async ({ page }) => { await expect(page).toHaveURL('/'); });\n"
        }),
        after: null
      })
    ]);
    expect(assessSemanticPublication(manifest)).toEqual({ allowed: true });
  });

  it('succeeds with no git-visible changes when pulse outputs are gitignored', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-publication-pulse-'));
    mkdirSync(join(workspace, 'projects/shop/derived/reports'), { recursive: true });
    writeFileSync(
      join(workspace, '.gitignore'),
      ['projects/*/derived/reports/*', '!projects/*/derived/reports/.generated.md'].join('\n')
    );
    writeFileSync(join(workspace, 'projects/shop/derived/reports/.generated.md'), 'baseline\n');
    git(workspace, 'init');
    git(workspace, 'config', 'user.name', 'Test');
    git(workspace, 'config', 'user.email', 'test@example.test');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'baseline');
    writeFileSync(
      join(workspace, 'projects/shop/derived/reports/quality-pulse-presentation.json'),
      '{"title":"pulse"}\n'
    );

    const manifest = preparePublicationManifest({
      workspace,
      requestId: 'REQ-PULSE',
      projectRoot: 'projects/shop',
      checks: [
        {
          command: process.execPath,
          args: ['-e', "process.stdout.write('ok')"]
        }
      ]
    });

    expect(manifest.changes).toEqual([]);
    expect(manifest.checks[0]).toMatchObject({ exitCode: 0 });
  });

  it('stamps Slack requester authority so onboard governed sources can publish', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'qali-publication-onboard-'));
    const contextPath = 'projects/shop/sources/project-context.md';
    mkdirSync(join(workspace, 'projects/shop/sources'), { recursive: true });
    writeFileSync(join(workspace, contextPath), '# QA Project Context\n\nUnknown\n');
    git(workspace, 'init');
    git(workspace, 'config', 'user.name', 'Test');
    git(workspace, 'config', 'user.email', 'test@example.test');
    git(workspace, 'add', '.');
    git(workspace, 'commit', '-m', 'baseline');
    writeFileSync(
      join(workspace, contextPath),
      '# QA Project Context\n\n- FACT-001 | The live target origin is https://www.saucedemo.com.\n'
    );

    expect(authorityRefFromCommand({ requestedBy: 'github-schedule' })).toBeUndefined();
    expect(authorityRefFromCommand({ requestedBy: 'U099MTX6423' })).toBe('slack-user:U099MTX6423');

    const manifest = preparePublicationManifest({
      workspace,
      requestId: 'REQ-ONBOARD',
      projectRoot: 'projects/shop',
      provenanceRef: 'workflow:REQ-ONBOARD',
      authorityRef: 'slack-user:U099MTX6423',
      checks: [
        {
          command: process.execPath,
          args: ['-e', "process.stdout.write('ok')"]
        }
      ]
    });

    expect(manifest.reviewOnly).toBe(true);
    expect(manifest.changes).toEqual([
      expect.objectContaining({
        path: contextPath,
        classification: 'governed-source',
        provenanceRef: 'workflow:REQ-ONBOARD',
        authorityRef: 'slack-user:U099MTX6423'
      })
    ]);
    expect(assessSemanticPublication(manifest)).toEqual({ allowed: true });
  });
});
