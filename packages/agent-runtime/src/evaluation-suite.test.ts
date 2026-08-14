import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadEvaluationSuite,
  parseEvaluationSuite,
  runEvaluationSuite
} from './evaluation-suite.js';

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

describe('qualification evaluation suite', () => {
  it('rejects an empty eval suite', () => {
    expect(() => parseEvaluationSuite({ version: 1, cases: [] })).toThrow();
  });

  it('loads the version-controlled suite and passes fail-closed harness invariants', () => {
    const suite = loadEvaluationSuite('qualification/evaluation-suite.json');
    expect(suite.cases.map((entry) => entry.id)).toEqual([
      'charter-focus-and-method',
      'coverage-map-columns',
      'agent-cli-denies-shell',
      'browser-mcp-only-when-allowed'
    ]);
    const result = runEvaluationSuite(process.cwd(), suite);
    expect(result.passed).toBe(true);
    expect(result.results.every((entry) => entry.passed)).toBe(true);
  });

  it('fails closed when a charter skill omits Focus or Method', () => {
    expect(
      runEvaluationSuite(process.cwd(), {
        version: 1,
        cases: [
          {
            id: 'charter-focus-and-method',
            kind: 'skill-invariant',
            description: 'charter',
            skillId: 'exploratory-testing',
            mustInclude: ['Focus:', 'Method:', 'this-string-is-not-in-the-skill']
          }
        ]
      }).passed
    ).toBe(false);
  });
});
