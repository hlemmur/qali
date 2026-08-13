import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePublicationManifest } from './prepare-publication.js';

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
});
