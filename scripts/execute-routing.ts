import type { NormalizedCommand } from '../packages/contracts/src/index.js';

export type AgentExecutionRoute =
  | 'deterministic-onboarding'
  | 'deterministic-exploration'
  | 'deterministic-test-generation'
  | 'deterministic-triage'
  | 'deterministic-knowledge-maintenance'
  | 'deterministic-suite-maintenance'
  | 'deterministic-quality-pulse'
  | 'deterministic-query-project'
  | 'deterministic-schedule-maintenance'
  | 'deterministic-fallback'
  | 'cursor';

export function requiresQualifiedAgentRuntime(
  intent: NormalizedCommand['intent'],
  environmentLabel: 'mock' | 'staging' | 'production'
): boolean {
  if (environmentLabel === 'mock') return false;
  // Host-owned workflows do not invoke Cursor; production still has an empty qualification registry.
  return !(
    intent === 'quality-pulse' ||
    intent === 'query-project' ||
    intent === 'maintain-schedule' ||
    intent === 'onboard-project' ||
    intent === 'run-test-suite'
  );
}

export function selectAgentExecutionRoute(
  command: NormalizedCommand,
  cursorCliAvailable: boolean,
  mockMode = false
): AgentExecutionRoute {
  if (command.intent === 'onboard-project') return 'deterministic-onboarding';
  if (mockMode && command.intent === 'explore-project') return 'deterministic-exploration';
  if (mockMode && command.intent === 'generate-test-suite') {
    return 'deterministic-test-generation';
  }
  if (mockMode && command.intent === 'triage-failure') return 'deterministic-triage';
  if (mockMode && command.intent === 'maintain-knowledge') {
    return 'deterministic-knowledge-maintenance';
  }
  if (mockMode && command.intent === 'maintain-suite') {
    return 'deterministic-suite-maintenance';
  }
  if (command.intent === 'quality-pulse') return 'deterministic-quality-pulse';
  if (command.intent === 'query-project') return 'deterministic-query-project';
  if (command.intent === 'maintain-schedule') return 'deterministic-schedule-maintenance';
  return cursorCliAvailable ? 'cursor' : 'deterministic-fallback';
}
