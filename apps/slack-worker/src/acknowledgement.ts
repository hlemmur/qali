import type { Intent, NormalizedCommand } from '@qali/contracts';

export const WORK_PHASES = {
  checking: 'Checking project and permission',
  lookingUp: 'Looking that up',
  starting: 'Starting the test target',
  exploring: 'Exploring the product',
  running: 'Running tests',
  generating: 'Generating tests',
  triaging: 'Reading failure evidence',
  validating: 'Checking generated artifacts',
  publishing: 'Preparing a review change'
} as const;

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function inferredSuite(command: NormalizedCommand): string {
  const suite = command.parameters.suite;
  return typeof suite === 'string' && suite.trim() ? suite.trim() : 'smoke';
}

export function inferredEnvironment(command: NormalizedCommand): string {
  return command.project.environmentLabel ?? command.project.environment ?? 'production';
}

export function formatChannelAffinity(command: NormalizedCommand): string {
  return `I'll use \`${command.project.id}\`, ${inferredEnvironment(command)}, ${inferredSuite(command)}.`;
}

export function initialWorkPhase(intent: Intent): string {
  if (intent === 'query-project') return WORK_PHASES.lookingUp;
  return WORK_PHASES.checking;
}

export function dispatchedWorkPhase(intent: Intent): string {
  switch (intent) {
    case 'query-project':
      return WORK_PHASES.lookingUp;
    case 'explore-project':
      return WORK_PHASES.exploring;
    case 'run-test-suite':
      return WORK_PHASES.running;
    case 'generate-test-suite':
      return WORK_PHASES.generating;
    case 'triage-failure':
      return WORK_PHASES.triaging;
    default:
      return WORK_PHASES.starting;
  }
}

export function formatWorkAcknowledgement(
  command: NormalizedCommand,
  phase: string,
  elapsedMs?: number
): string {
  const elapsed = elapsedMs === undefined ? '' : ` (${formatElapsed(elapsedMs)})`;
  return `${formatChannelAffinity(command)}\n${phase}${elapsed}`;
}
