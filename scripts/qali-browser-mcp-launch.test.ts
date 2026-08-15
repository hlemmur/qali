import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('qali-browser MCP launcher', () => {
  it('fails closed when the env file is missing', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(process.cwd(), 'scripts/qali-browser-mcp-launch.ts'),
        join(tmpdir(), 'missing-qali-browser.env'),
        join(process.cwd(), 'scripts/browser-facade-mcp.ts')
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/env file is missing/i);
  });

  it('loads env keys before importing the service script', () => {
    const directory = mkdtempSync(join(tmpdir(), 'qali-mcp-launch-'));
    const envFile = join(directory, 'browser.env');
    const service = join(directory, 'service.mjs');
    writeFileSync(envFile, 'QALI_LAUNCH_PROBE=loaded-from-file\n');
    writeFileSync(
      service,
      'if (process.env.QALI_LAUNCH_PROBE !== "loaded-from-file") {\n' +
        '  console.error("env not loaded");\n  process.exit(2);\n}\n' +
        'console.log("launcher-ok");\nprocess.exit(0);\n'
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(process.cwd(), 'scripts/qali-browser-mcp-launch.ts'),
        envFile,
        service
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('launcher-ok');
  });
});
