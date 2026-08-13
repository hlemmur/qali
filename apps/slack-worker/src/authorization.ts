import type { ExternalRole, NormalizedCommand } from '@qali/contracts';

export type AuthorizationDecision = { allowed: true } | { allowed: false; reason: string };

const DEVELOPER_INTENTS = new Set<NormalizedCommand['intent']>([
  'explore-project',
  'generate-test-suite',
  'run-test-suite',
  'triage-failure',
  'quality-pulse',
  'query-project'
]);

const GOVERNANCE_KEY = /(?:autonomy|policy|authority|approval|expected.?behavior|baseline)/i;
const PRIVILEGED_ACTION = /(?:autonomy|policy|authority|approve|baseline|maintenance)/i;

const csv = (value?: string): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

export function externalRoleForUser(userId: string, qaLeadIds?: string): ExternalRole {
  return csv(qaLeadIds).has(userId) ? 'qa-lead-admin' : 'developer';
}

export function isPrivilegedAction(actionId: string): boolean {
  return PRIVILEGED_ACTION.test(actionId);
}

function hasGovernanceParameters(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => GOVERNANCE_KEY.test(key) || hasGovernanceParameters(child)
  );
}

export function authorizeCommand(command: NormalizedCommand): AuthorizationDecision {
  if (command.externalRole === 'qa-lead-admin') return { allowed: true };
  if (!DEVELOPER_INTENTS.has(command.intent)) {
    return {
      allowed: false,
      reason: `Developer role cannot request ${command.intent}`
    };
  }
  if (command.autonomy || hasGovernanceParameters(command.parameters)) {
    return {
      allowed: false,
      reason: 'Developer role cannot change autonomy, policy, approval, or authority'
    };
  }
  return { allowed: true };
}
