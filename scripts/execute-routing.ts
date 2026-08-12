import type { NormalizedCommand } from '../packages/contracts/src/index.js';

export type AgentExecutionRoute =
  | 'deterministic-onboarding'
  | 'deterministic-fallback'
  | 'cursor';

export function selectAgentExecutionRoute(
  command: NormalizedCommand,
  cursorCliAvailable: boolean
): AgentExecutionRoute {
  if (command.intent === 'onboard-project') return 'deterministic-onboarding';
  return cursorCliAvailable ? 'cursor' : 'deterministic-fallback';
}
