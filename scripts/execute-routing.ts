import type { NormalizedCommand } from '../packages/contracts/src/index.js';

export type AgentExecutionRoute =
  'deterministic-onboarding' | 'deterministic-exploration' | 'deterministic-fallback' | 'cursor';

export function selectAgentExecutionRoute(
  command: NormalizedCommand,
  cursorCliAvailable: boolean,
  mockMode = false
): AgentExecutionRoute {
  if (command.intent === 'onboard-project') return 'deterministic-onboarding';
  if (mockMode && command.intent === 'explore-project') return 'deterministic-exploration';
  return cursorCliAvailable ? 'cursor' : 'deterministic-fallback';
}
