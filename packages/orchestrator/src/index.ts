import {
  classifyMutation,
  type AutoMergeClass,
  type MutationKind
} from '../../knowledge/src/index.js';

export type OpenItemKind = 'question' | 'known-issue-review' | 'review-marker';

export interface OpenItem {
  id: string;
  kind: OpenItemKind;
  blocking: boolean;
  summary: string;
  source: string;
}

export interface OpenItemsResult {
  items: OpenItem[];
  overrideAllowed: boolean;
}

export interface OpenItemSources {
  questions?: string;
  knownIssues?: string;
  reviewMarkers?: string;
  decisions?: string;
}

interface MarkdownBlock {
  id: string;
  summary: string;
  body: string;
}

function blocks(markdown: string): MarkdownBlock[] {
  const result: MarkdownBlock[] = [];
  let current: { id: string; summary: string; lines: string[] } | undefined;

  for (const line of markdown.split('\n')) {
    const heading = /^###\s+([^:]+)(?::\s*(.*))?$/.exec(line);
    if (heading) {
      if (current) {
        result.push({ id: current.id, summary: current.summary, body: current.lines.join('\n') });
      }
      current = {
        id: heading[1]?.trim() ?? 'UNKNOWN',
        summary: heading[2]?.trim() ?? '',
        lines: []
      };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    result.push({ id: current.id, summary: current.summary, body: current.lines.join('\n') });
  }
  return result;
}

function field(body: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^[\\s-]*\\*{0,2}${escaped}\\*{0,2}\\s*:\\s*(.+)$`, 'im')
      .exec(body)?.[1]
      ?.trim()
      .replace(/\*/g, '') ?? ''
  );
}

export function aggregateOpenItems(sources: OpenItemSources): OpenItemsResult {
  const items: OpenItem[] = [];

  if (sources.questions) {
    for (const block of blocks(sources.questions)) {
      if (field(block.body, 'Status').toLowerCase() === 'open') {
        items.push({
          id: block.id,
          kind: 'question',
          blocking: field(block.body, 'Blocking').toLowerCase() === 'yes',
          summary: block.summary,
          source: 'questions.md'
        });
      }
    }
  }

  if (sources.knownIssues) {
    for (const block of blocks(sources.knownIssues)) {
      if (field(block.body, 'Human review').toLowerCase() === 'pending') {
        items.push({
          id: block.id,
          kind: 'known-issue-review',
          blocking: false,
          summary: block.summary,
          source: 'known-issues.md'
        });
      }
    }
  }

  if (sources.reviewMarkers) {
    let index = 0;
    for (const match of sources.reviewMarkers.matchAll(/^\s*-\s*\[\s*\]\s*REVIEW:\s*(.+)$/gim)) {
      index += 1;
      items.push({
        id: `REVIEW-${index}`,
        kind: 'review-marker',
        blocking: false,
        summary: match[1]?.trim() ?? '',
        source: 'review-markers'
      });
    }
  }

  const overrideAllowed = /allow proceed with open questions:\**\s*yes/i.test(
    sources.decisions ?? ''
  );
  return { items, overrideAllowed };
}

export function isExecutionBlocked(result: OpenItemsResult): boolean {
  return result.items.some((item) => item.blocking) && !result.overrideAllowed;
}

export interface AutonomyRequest {
  mutation: MutationKind;
  workClass: 'discovery' | 'execution' | 'reporting';
  inbox: OpenItemsResult;
}

export type AutonomyDecision =
  | { allowed: true; mergeClass: AutoMergeClass }
  | { allowed: false; mergeClass: AutoMergeClass; reason: string };

export function decideAutonomy(request: AutonomyRequest): AutonomyDecision {
  const mergeClass = classifyMutation(request.mutation);

  if (mergeClass === 'prohibited') {
    return { allowed: false, mergeClass, reason: 'mutation is prohibited by policy' };
  }
  if (mergeClass === 'human-approval') {
    return {
      allowed: false,
      mergeClass,
      reason: 'mutation requires explicit human approval'
    };
  }
  if (request.workClass === 'execution' && isExecutionBlocked(request.inbox)) {
    return {
      allowed: false,
      mergeClass,
      reason: 'execution is blocked by unresolved human decisions'
    };
  }

  return { allowed: true, mergeClass };
}

export interface InternalBinding {
  id: string;
  purpose: string;
  policies: string[];
  inputs: string[];
  outputs: string[];
  guardrails: string[];
}

export const BINDING_CATALOG: InternalBinding[] = [
  {
    id: 'project-discovery',
    purpose: 'Build black-box product knowledge from documents and time-boxed exploration.',
    policies: ['core/policies/operating-model.md', 'core/policies/evidence-and-provenance.md'],
    inputs: ['project context', 'documentation', 'target environment'],
    outputs: ['reference updates', 'session evidence', 'open questions'],
    guardrails: ['Discovery is soft-gated.', 'New product facts remain observed or inferred.']
  },
  {
    id: 'knowledge-curator',
    purpose: 'Route durable facts to one owner and preserve provenance.',
    policies: [
      'core/policies/evidence-and-provenance.md',
      'core/policies/authority-and-autonomy.md'
    ],
    inputs: ['new evidence', 'existing project knowledge'],
    outputs: ['provenance updates', 'contradictions', 'open questions'],
    guardrails: ['Never silently overwrite conflicts.', 'Confirmation requires human authority.']
  },
  {
    id: 'smoke-test-design',
    purpose: 'Draft a minimal, source-labeled smoke scope before automation.',
    policies: ['core/policies/test-authoring.md', 'core/policies/authority-and-autonomy.md'],
    inputs: ['primary journey', 'UI inventory', 'testability notes'],
    outputs: ['smoke proposal', 'automation assumptions'],
    guardrails: ['No test code before approval.', 'Observation-sourced cases need review.']
  },
  {
    id: 'scope-proposal',
    purpose: 'Synthesize traceable client scope from project artifacts.',
    policies: ['core/policies/operating-model.md', 'core/policies/authority-and-autonomy.md'],
    inputs: ['risk matrix', 'strategy', 'plan', 'open questions'],
    outputs: ['draft scope proposal'],
    guardrails: ['Do not invent coverage or effort.', 'Human approval is required before sending.']
  },
  {
    id: 'task-tracker',
    purpose: 'Keep substantive QA work linked, reviewable, and honest.',
    policies: ['core/policies/operating-model.md'],
    inputs: ['requested work', 'artifact links', 'verification results'],
    outputs: ['task status', 'progress notes', 'follow-up work'],
    guardrails: ['Never hide failed checks.', 'Never mark human review approved autonomously.']
  }
];
