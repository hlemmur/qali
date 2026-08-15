import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ProjectExecutionProfile } from '../packages/contracts/src/index.js';

const OPTIONAL_BROWSER_ENV = ['QALI_BROWSER_EXECUTABLE_PATH'] as const;

export function assembledHarnessEvidenceDirectory(harnessWorkspace: string): string {
  return join(harnessWorkspace, 'outputs/evidence');
}

export function browserMcpEnvironmentNames(profile: ProjectExecutionProfile): readonly string[] {
  return [
    'QALI_EXECUTION_PROFILE_PATH',
    profile.targetVariables.baseUrl,
    profile.targetVariables.allowedOrigins,
    profile.targetVariables.credentials,
    profile.targetVariables.testData,
    'QALI_BROWSER_EVIDENCE_DIR',
    ...OPTIONAL_BROWSER_ENV
  ];
}

export function parseBrowserMcpEnvironmentFile(path: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    parsed[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return parsed;
}

export function writeBrowserMcpEnvironmentFile(request: {
  destination: string;
  executionProfilePath: string;
  evidenceDirectory: string;
  profile: ProjectExecutionProfile;
  env: NodeJS.ProcessEnv;
}): void {
  if (!isAbsolute(request.executionProfilePath)) {
    throw new Error('QALI_EXECUTION_PROFILE_PATH must be an absolute path');
  }
  if (!isAbsolute(request.evidenceDirectory)) {
    throw new Error('QALI_BROWSER_EVIDENCE_DIR must be an absolute path');
  }
  const assigned: Record<string, string> = {
    QALI_EXECUTION_PROFILE_PATH: request.executionProfilePath,
    QALI_BROWSER_EVIDENCE_DIR: request.evidenceDirectory
  };
  for (const name of browserMcpEnvironmentNames(request.profile)) {
    if (name === 'QALI_EXECUTION_PROFILE_PATH' || name === 'QALI_BROWSER_EVIDENCE_DIR') continue;
    const value = request.env[name]?.trim();
    if (value) assigned[name] = value;
  }
  writeFileSync(
    request.destination,
    `${Object.entries(assigned)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\n`
  );
}
