export const PUBLICATION_MUTATIONS = [
  'append-observation',
  'append-evidence',
  'render-derived-report',
  'format-document',
  'create-test',
  'repair-test-equivalent',
  'update-governed-source',
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'delete-test',
  'skip-test',
  'weaken-assertion',
  'modify-source-code'
] as const;

export type PublicationMutation = (typeof PUBLICATION_MUTATIONS)[number];

export interface PublicationChange {
  path: string;
  mutation: PublicationMutation;
  content?: string;
  deleted?: boolean;
  provenanceRef?: string;
  approvedScenarioRef?: string;
  authorityRef?: string;
}

export interface DeterministicCheck {
  name: string;
  passed: boolean;
}

export interface PublicationRequest {
  requestId: string;
  baseBranch: string;
  title: string;
  commitMessage: string;
  checks: DeterministicCheck[];
  changes: PublicationChange[];
}

export type PublicationPolicyDecision = { allowed: true } | { allowed: false; reason: string };

const ALWAYS_REJECT = new Set<PublicationMutation>([
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'delete-test',
  'skip-test',
  'weaken-assertion',
  'modify-source-code'
]);

const isSafePath = (path: string): boolean =>
  path.startsWith('projects/') &&
  !path.startsWith('/') &&
  !path.split('/').includes('..') &&
  !path.includes('\\');

function assessChange(change: PublicationChange): PublicationPolicyDecision {
  if (!isSafePath(change.path)) {
    return { allowed: false, reason: `path is outside governed projects: ${change.path}` };
  }
  if (change.deleted)
    return { allowed: false, reason: `deletions are not publishable: ${change.path}` };
  if (ALWAYS_REJECT.has(change.mutation)) {
    return {
      allowed: false,
      reason: `mutation is not automatically publishable: ${change.mutation}`
    };
  }
  if (typeof change.content !== 'string') {
    return { allowed: false, reason: `published file content is required: ${change.path}` };
  }

  if (change.path.includes('/derived/')) {
    return ['render-derived-report', 'format-document'].includes(change.mutation)
      ? { allowed: true }
      : { allowed: false, reason: `mutation does not match derived ownership: ${change.path}` };
  }
  if (change.path.includes('/observations/')) {
    return ['append-observation', 'append-evidence'].includes(change.mutation) &&
      Boolean(change.provenanceRef)
      ? { allowed: true }
      : {
          allowed: false,
          reason: `observations require a safe append and provenance: ${change.path}`
        };
  }
  if (change.path.includes('/tests/')) {
    return ['create-test', 'repair-test-equivalent'].includes(change.mutation) &&
      Boolean(change.approvedScenarioRef)
      ? { allowed: true }
      : {
          allowed: false,
          reason: `tests require an approved scenario and safe mutation: ${change.path}`
        };
  }
  if (change.path.includes('/sources/')) {
    if (change.path.endsWith('/decisions.md') || change.path.endsWith('/autonomy-policy.md')) {
      return {
        allowed: false,
        reason: `authority artifacts require human publication: ${change.path}`
      };
    }
    return change.mutation === 'update-governed-source' &&
      Boolean(change.authorityRef) &&
      Boolean(change.provenanceRef)
      ? { allowed: true }
      : {
          allowed: false,
          reason: `governed source changes require authority and provenance: ${change.path}`
        };
  }
  return { allowed: false, reason: `path class is not automatically publishable: ${change.path}` };
}

export function assessGeneratedChanges(request: PublicationRequest): PublicationPolicyDecision {
  if (request.baseBranch !== 'main') {
    return { allowed: false, reason: 'controlled publication targets main through a pull request' };
  }
  if (request.checks.length === 0 || request.checks.some((check) => !check.passed)) {
    return { allowed: false, reason: 'all deterministic checks must pass before publication' };
  }
  if (request.changes.length === 0) {
    return { allowed: false, reason: 'there are no generated changes to publish' };
  }
  for (const change of request.changes) {
    const decision = assessChange(change);
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}

export interface PullRequestReference {
  number: number;
  nodeId: string;
  url: string;
}

export interface GitHubPublicationPort {
  createBranch(branch: string, baseBranch: string): Promise<void>;
  commit(branch: string, message: string, changes: PublicationChange[]): Promise<void>;
  createPullRequest(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<PullRequestReference>;
  enableAutoMerge(pullRequestNodeId: string): Promise<void>;
}

export type PublicationResult =
  | { status: 'rejected'; reason: string }
  | { status: 'published'; branch: string; pullRequestUrl: string };

const branchToken = (requestId: string): string =>
  requestId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

export class ControlledPublisher {
  constructor(private readonly github: GitHubPublicationPort) {}

  async publish(request: PublicationRequest): Promise<PublicationResult> {
    const decision = assessGeneratedChanges(request);
    if (!decision.allowed) return { status: 'rejected', reason: decision.reason };

    const branch = `qali/${branchToken(request.requestId)}`;
    await this.github.createBranch(branch, request.baseBranch);
    await this.github.commit(branch, request.commitMessage, request.changes);
    const pullRequest = await this.github.createPullRequest({
      branch,
      baseBranch: request.baseBranch,
      title: request.title,
      body: [
        'Generated by Qali controlled publication.',
        '',
        'Deterministic checks:',
        ...request.checks.map((check) => `- [x] ${check.name}`)
      ].join('\n')
    });
    await this.github.enableAutoMerge(pullRequest.nodeId);
    return { status: 'published', branch, pullRequestUrl: pullRequest.url };
  }
}
