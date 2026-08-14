#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ModelQualificationRecordSchema } from '../packages/contracts/src/index.js';
import { computeRuntimeQualificationIdentity } from '../packages/agent-runtime/src/qualification-identity.js';
import {
  loadEvaluationSuite,
  runEvaluationSuite
} from '../packages/agent-runtime/src/evaluation-suite.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const repositoryRoot = resolve(process.cwd());
const PINNED_CURSOR_VERSION = '2026.08.11-e8db854';

function cursorCliVersion(): string {
  const fromEnv = process.env.QALI_QUALIFY_CURSOR_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const reported = execFileSync('agent', ['--version'], { encoding: 'utf8' }).trim();
    const match = reported.match(/20\d{2}\.\d{2}\.\d{2}-[a-f0-9]+/);
    return match?.[0] ?? reported;
  } catch {
    return PINNED_CURSOR_VERSION;
  }
}

function qualificationRunUrl(): string {
  const fromEnv = process.env.QALI_QUALIFICATION_RUN_URL?.trim();
  if (fromEnv) return fromEnv;
  const server = process.env.GITHUB_SERVER_URL?.trim() || 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (repo && runId) return `${server}/${repo}/actions/runs/${runId}`;
  throw new Error(
    'QALI_QUALIFICATION_RUN_URL or GITHUB_RUN_ID is required to write a registry record'
  );
}

const suite = loadEvaluationSuite(join(repositoryRoot, 'qualification/evaluation-suite.json'));
const evaluation = runEvaluationSuite(repositoryRoot, suite);
if (!evaluation.passed) {
  console.error(JSON.stringify({ passed: false, results: evaluation.results }, null, 2));
  process.exitCode = 1;
  throw new Error('evaluation suite failed');
}

const modelIdentifier =
  process.env.CURSOR_MODEL?.trim() || process.env.QALI_QUALIFY_MODEL?.trim() || 'composer-2.5';
const identity = computeRuntimeQualificationIdentity({
  repositoryRoot,
  cursorCliVersion: cursorCliVersion(),
  modelIdentifier
});
const qualifiedAt = new Date().toISOString();
const record = ModelQualificationRecordSchema.parse({
  version: 1,
  ...identity,
  qualificationRunUrl: qualificationRunUrl(),
  result: 'passed',
  qualifiedAt,
  expiresAt: new Date(Date.parse(qualifiedAt) + THIRTY_DAYS_MS).toISOString(),
  state: 'active'
});

const outputPath = resolve(
  process.argv.includes('--write-registry')
    ? 'qualification/registry.json'
    : (process.env.QALI_QUALIFICATION_OUTPUT ?? 'qualification/candidate-record.json')
);
mkdirSync(dirname(outputPath), { recursive: true });
if (process.argv.includes('--write-registry')) {
  writeFileSync(
    'qualification/registry.json',
    `${JSON.stringify({ version: 1, records: [record] }, null, 2)}\n`
  );
} else {
  writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
}

console.log(
  JSON.stringify(
    {
      passed: true,
      results: evaluation.results,
      identity,
      qualificationRunUrl: record.qualificationRunUrl,
      outputPath
    },
    null,
    2
  )
);
