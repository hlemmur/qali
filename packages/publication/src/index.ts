import { createHash } from 'node:crypto';
import ts from 'typescript';
import {
  SemanticPublicationManifestSchema,
  type PublicationChangeClassification,
  type SemanticPublicationChange,
  type SemanticPublicationManifest
} from '../../contracts/src/index.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function oracleFingerprint(source: string): string {
  const file = ts.createSourceFile('publication.spec.ts', source, ts.ScriptTarget.Latest, true);
  const assertions: string[] = [];
  const expectModifiers = (expression: ts.Expression): string[] | null => {
    const modifiers: string[] = [];
    let current = expression;
    while (ts.isPropertyAccessExpression(current)) {
      modifiers.unshift(current.name.text);
      current = current.expression;
    }
    return ts.isIdentifier(current) && current.text === 'expect' ? modifiers : null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const chain: string[] = [];
      let expression: ts.Expression = node.expression;
      while (ts.isPropertyAccessExpression(expression)) {
        chain.unshift(expression.name.text);
        expression = expression.expression;
      }
      const modifiers = ts.isCallExpression(expression)
        ? expectModifiers(expression.expression)
        : null;
      if (ts.isCallExpression(expression) && modifiers) {
        const subject = expression.arguments
          .map((argument) => argument.getText(file).replace(/\s+/g, ' '))
          .join(',');
        const args = node.arguments.map((argument) => argument.getText(file).replace(/\s+/g, ' '));
        assertions.push(`${modifiers.join('.')}:${subject}:${chain.join('.')}:${args.join(',')}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sha256(JSON.stringify(assertions));
}

const containsSkippedTest = (source: string): boolean =>
  /\b(?:test|describe)(?:\.describe)?\.(?:fixme|skip)\s*\(/.test(source);

function hasValidGeneratedHash(path: string, content: string): boolean {
  if (path.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const marker = parsed._qali as Record<string, unknown> | undefined;
      const body = { ...parsed };
      delete body._qali;
      return (
        marker?.generated === 'owner=qali' &&
        typeof marker.sha256 === 'string' &&
        marker.sha256 === sha256(JSON.stringify(body))
      );
    } catch {
      return false;
    }
  }
  const match = /^<!-- qali:generated owner=qali sha256=([a-f0-9]{64}) -->([\s\S]*)$/.exec(content);
  return Boolean(match && match[1] === sha256(match[2]!));
}

const RAW_EVIDENCE_PATTERN =
  /(?:^|\/)(?:cookies?|logs?|screenshots?|traces?|videos?)(?:\/|\.|$)|\.(?:gif|har|jpe?g|log|mp4|png|trace|webm|webp|zip)$/i;

export function classifyPublicationPath(path: string): PublicationChangeClassification {
  if (RAW_EVIDENCE_PATTERN.test(path)) return 'raw-evidence';
  if (path.includes('/observations/')) return 'observation';
  if (path.includes('/tests/')) return 'test';
  if (path.includes('/sources/')) return 'governed-source';
  if (path.includes('/derived/')) return 'derived-artifact';
  return 'unsupported';
}

export function createSemanticPublicationChange(input: {
  path: string;
  before: string | null;
  after: string | null;
  provenanceRef?: string;
  approvedScenarioRef?: string;
  generationSourceRef?: string;
  authorityRef?: string;
}): SemanticPublicationChange {
  return {
    path: input.path,
    classification: classifyPublicationPath(input.path),
    before: input.before === null ? null : { content: input.before, sha256: sha256(input.before) },
    after: input.after === null ? null : { content: input.after, sha256: sha256(input.after) },
    ...(input.provenanceRef ? { provenanceRef: input.provenanceRef } : {}),
    ...(input.approvedScenarioRef ? { approvedScenarioRef: input.approvedScenarioRef } : {}),
    ...(input.generationSourceRef ? { generationSourceRef: input.generationSourceRef } : {}),
    ...(input.authorityRef ? { authorityRef: input.authorityRef } : {})
  };
}

export type PublicationPolicyDecision = { allowed: true } | { allowed: false; reason: string };

function isSafeProjectPath(path: string, projectRoot: string): boolean {
  if (!path.startsWith(`${projectRoot}/`) || path.includes('\\')) return false;
  const segments = path.split('/');
  return !segments.some((segment) => segment === '.' || segment === '..' || segment === '');
}

const RETRACTABLE_GENERATED_SPEC =
  /^projects\/[^/]+\/tests\/generated\/[^/]+\.generated\.spec\.ts$/;

export function isRetractableGeneratedSpec(path: string): boolean {
  return isSafePath(path) && RETRACTABLE_GENERATED_SPEC.test(path);
}

export function assessSemanticPublication(
  value: SemanticPublicationManifest
): PublicationPolicyDecision {
  let manifest: SemanticPublicationManifest;
  try {
    manifest = SemanticPublicationManifestSchema.parse(value);
  } catch {
    return { allowed: false, reason: 'semantic publication manifest is invalid' };
  }
  if (manifest.checks.some((check) => check.exitCode !== 0)) {
    return { allowed: false, reason: 'all executed publication checks must pass' };
  }
  for (const change of manifest.changes) {
    if (!isSafeProjectPath(change.path, manifest.projectRoot)) {
      return {
        allowed: false,
        reason: `unsafe path is outside the governed project: ${change.path}`
      };
    }
    if (change.classification !== classifyPublicationPath(change.path)) {
      return { allowed: false, reason: `semantic classification mismatch: ${change.path}` };
    }
    if (change.before && sha256(change.before.content) !== change.before.sha256) {
      return { allowed: false, reason: `before hash mismatch: ${change.path}` };
    }
    if (change.after && sha256(change.after.content) !== change.after.sha256) {
      return { allowed: false, reason: `after hash mismatch: ${change.path}` };
    }
    if (!change.after) {
      if (isRetractableGeneratedSpec(change.path) && change.before) continue;
      return { allowed: false, reason: `deletions are not publishable: ${change.path}` };
    }
    if (change.classification === 'raw-evidence') {
      return { allowed: false, reason: `raw browser evidence remains outside Git: ${change.path}` };
    }
    if (change.classification === 'observation') {
      if (!change.provenanceRef) {
        return { allowed: false, reason: `observations require provenance: ${change.path}` };
      }
      if (change.before && !change.after.content.startsWith(change.before.content)) {
        return {
          allowed: false,
          reason: `observation publication must be append-only: ${change.path}`
        };
      }
      continue;
    }
    if (change.classification === 'test') {
      if (!change.path.endsWith('.spec.ts')) {
        return {
          allowed: false,
          reason: `non-spec test artifacts and visual baselines are not publishable: ${change.path}`
        };
      }
      if (containsSkippedTest(change.after.content)) {
        return { allowed: false, reason: `skipped tests are not publishable: ${change.path}` };
      }
      if (!change.before) {
        if (!change.approvedScenarioRef && !change.generationSourceRef) {
          return {
            allowed: false,
            reason: `new tests require an approved scenario or generation source: ${change.path}`
          };
        }
        continue;
      }
      if (oracleFingerprint(change.before.content) !== oracleFingerprint(change.after.content)) {
        return {
          allowed: false,
          reason: `modified tests must preserve the assertion oracle fingerprint: ${change.path}`
        };
      }
      continue;
    }
    if (change.classification === 'governed-source') {
      if (
        change.path.endsWith('/sources/decisions.md') ||
        change.path.endsWith('/sources/autonomy-policy.md')
      ) {
        return {
          allowed: false,
          reason: `reviewer-owned authority artifacts cannot be generated: ${change.path}`
        };
      }
      if (!change.authorityRef || !change.provenanceRef) {
        return {
          allowed: false,
          reason: `governed source changes require authority and provenance: ${change.path}`
        };
      }
      continue;
    }
    if (change.classification === 'derived-artifact') {
      if (!hasValidGeneratedHash(change.path, change.after.content)) {
        return {
          allowed: false,
          reason: `derived artifact has an invalid generated hash: ${change.path}`
        };
      }
      continue;
    }
    return { allowed: false, reason: `semantic class is not publishable: ${change.path}` };
  }
  return { allowed: true };
}

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
  generationSourceRef?: string;
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

const ALWAYS_REJECT = new Set<PublicationMutation>([
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'delete-test',
  'skip-test',
  'weaken-assertion',
  'modify-source-code'
]);

function isSafePath(path: string): boolean {
  return (
    path.startsWith('projects/') &&
    !path.startsWith('/') &&
    !path.split('/').includes('..') &&
    !path.includes('\\')
  );
}

function assessChange(change: PublicationChange): PublicationPolicyDecision {
  if (!isSafePath(change.path)) {
    return { allowed: false, reason: `path is outside governed projects: ${change.path}` };
  }
  if (change.deleted) {
    if (isRetractableGeneratedSpec(change.path) && change.mutation === 'delete-test') {
      return { allowed: true };
    }
    return { allowed: false, reason: `deletions are not publishable: ${change.path}` };
  }
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
      Boolean(change.approvedScenarioRef || change.generationSourceRef)
      ? { allowed: true }
      : {
          allowed: false,
          reason: `tests require an approved scenario or generation source and a safe mutation: ${change.path}`
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
  commit(branch: string, message: string, changes: SemanticPublicationChange[]): Promise<void>;
  createPullRequest(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<PullRequestReference>;
  enableAutoMerge?(pullRequestNodeId: string): Promise<void>;
}

export type PublicationResult =
  | { status: 'rejected'; reason: string }
  | { status: 'skipped'; reason: string }
  | { status: 'published'; branch: string; pullRequestUrl: string };

const branchToken = (requestId: string): string =>
  requestId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

export class ControlledPublisher {
  constructor(private readonly github: GitHubPublicationPort) {}

  async publish(request: SemanticPublicationManifest): Promise<PublicationResult> {
    const decision = assessSemanticPublication(request);
    if (!decision.allowed) return { status: 'rejected', reason: decision.reason };
    if (request.changes.length === 0) {
      return { status: 'skipped', reason: 'no git-visible changes' };
    }

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
        request.reviewOnly
          ? '**Review-only publication. A separate code reviewer must merge this PR.**'
          : '**Tests and observations in the Qali repo auto-merge. Retract from Slack if this was wrong.**',
        '',
        'Executed deterministic checks:',
        ...request.checks.map(
          (check) =>
            `- [x] \`${[check.command, ...check.args].join(' ')}\` — exit ${check.exitCode} in ${check.durationMs} ms`
        )
      ].join('\n')
    });
    if (!request.reviewOnly) {
      await this.github.enableAutoMerge?.(pullRequest.nodeId);
    }
    return { status: 'published', branch, pullRequestUrl: pullRequest.url };
  }
}
