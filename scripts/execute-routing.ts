import type { NormalizedCommand } from '../packages/contracts/src/index.js';

export type AgentExecutionRoute =
  | 'deterministic-onboarding'
  | 'deterministic-exploration'
  | 'deterministic-test-generation'
  | 'deterministic-triage'
  | 'deterministic-knowledge-maintenance'
  | 'deterministic-fallback'
  | 'cursor';

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
  return cursorCliAvailable ? 'cursor' : 'deterministic-fallback';
}
