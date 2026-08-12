import { isAbsolute } from 'node:path';
import type { ProjectExecutionProfile } from '@qali/contracts';
import { resolveExecutionTarget } from '@qali/project-config';

type EnvironmentVariables = Record<string, string | undefined>;
type Scalar = string | number | boolean;

export interface BrowserServiceConfig {
  browserName: ProjectExecutionProfile['browser']['name'];
  baseUrl: string;
  allowedOrigins: string[];
  credentials: Record<string, string>;
  testData: Record<string, Scalar>;
  evidenceDirectory: string;
  allowedSubmissions: Array<{ role: string; name: string }>;
  redactionPatterns: string[];
  executablePath?: string;
}

function scalarRecord(
  value: Record<string, unknown>,
  label: string,
  stringsOnly: boolean
): Record<string, Scalar> {
  const entries = Object.entries(value);
  if (
    entries.some(
      ([, entry]) =>
        (stringsOnly && typeof entry !== 'string') ||
        (!stringsOnly && !['string', 'number', 'boolean'].includes(typeof entry))
    )
  ) {
    throw new Error(`${label} must contain only scalar values`);
  }
  return Object.fromEntries(entries) as Record<string, Scalar>;
}

export function resolveBrowserServiceConfig(
  profile: ProjectExecutionProfile,
  variables: EnvironmentVariables
): BrowserServiceConfig {
  if (profile.browser.allowDownloads || profile.browser.allowPopups) {
    throw new Error('Browser facade requires downloads and popups to be disabled');
  }
  const target = resolveExecutionTarget(profile, variables);
  const evidenceDirectory = variables.QALI_BROWSER_EVIDENCE_DIR?.trim();
  if (!evidenceDirectory) throw new Error('Missing QALI_BROWSER_EVIDENCE_DIR');
  if (!isAbsolute(evidenceDirectory)) {
    throw new Error('QALI_BROWSER_EVIDENCE_DIR must be an absolute path');
  }
  const credentials = scalarRecord(target.credentials, 'QALI_TEST_CREDENTIALS_JSON', true);
  return {
    browserName: target.browser.name,
    baseUrl: target.baseUrl,
    allowedOrigins: target.allowedOrigins,
    credentials: credentials as Record<string, string>,
    testData: scalarRecord(target.testData, 'QALI_TEST_DATA_JSON', false),
    evidenceDirectory,
    allowedSubmissions: target.browser.allowedSubmissions,
    redactionPatterns: target.redactionPatterns,
    ...(variables.QALI_BROWSER_EXECUTABLE_PATH?.trim()
      ? { executablePath: variables.QALI_BROWSER_EXECUTABLE_PATH.trim() }
      : {})
  };
}
