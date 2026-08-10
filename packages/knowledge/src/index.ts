export const EVIDENCE_STATUSES = [
  'confirmed',
  'observed',
  'inferred',
  'unknown',
  'outdated'
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export interface EvidenceSource {
  kind: 'human-decision' | 'authoritative-doc' | 'trace' | 'report' | 'session' | 'screenshot';
  ref: string;
  observedAt: string;
}

export interface KnowledgeFact {
  id: string;
  statement: string;
  status: EvidenceStatus;
  sources: EvidenceSource[];
}

export interface PromotionRequest {
  fact: KnowledgeFact;
  targetStatus: EvidenceStatus;
  purpose: 'reference' | 'expected-behavior';
  authority: {
    actor: 'agent' | 'human';
    decisionRef?: string;
    authoritativeSourceRef?: string;
  };
}

export type GovernanceDecision = { allowed: true } | { allowed: false; reason: string };

export function assessPromotion(request: PromotionRequest): GovernanceDecision {
  if (request.targetStatus !== 'confirmed') {
    return { allowed: true };
  }

  const hasHumanDecision =
    request.authority.actor === 'human' && Boolean(request.authority.decisionRef);
  const hasAuthoritativeSource = Boolean(request.authority.authoritativeSourceRef);

  if (!hasHumanDecision && !hasAuthoritativeSource) {
    return {
      allowed: false,
      reason:
        request.purpose === 'expected-behavior'
          ? 'expected behavior requires a recorded human decision or authoritative source'
          : 'confirmation requires a recorded human decision or authoritative source'
    };
  }

  return { allowed: true };
}

export const MUTATION_KINDS = [
  'append-observation',
  'append-evidence',
  'render-derived-report',
  'format-document',
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'file-external-ticket',
  'send-client-proposal',
  'delete-test',
  'skip-test',
  'weaken-assertion'
] as const;

export type MutationKind = (typeof MUTATION_KINDS)[number];
export type AutoMergeClass = 'auto-merge' | 'human-approval' | 'prohibited';

const HUMAN_APPROVAL_MUTATIONS = new Set<MutationKind>([
  'promote-to-confirmed',
  'change-expected-behavior',
  'update-visual-baseline',
  'file-external-ticket',
  'send-client-proposal',
  'delete-test',
  'skip-test'
]);

export function classifyMutation(mutation: MutationKind): AutoMergeClass {
  if (mutation === 'weaken-assertion') {
    return 'prohibited';
  }
  return HUMAN_APPROVAL_MUTATIONS.has(mutation) ? 'human-approval' : 'auto-merge';
}

export const REQUIRED_PROJECT_KNOWLEDGE_SECTIONS = [
  'Product',
  'Tech Stack',
  'Test Stack',
  'CI/CD',
  'Environments',
  'Quality Goals',
  'Risk Areas',
  'Team',
  'Conventions'
] as const;

export interface KnowledgeValidationIssue {
  code: 'missing-section' | 'placeholder';
  message: string;
  section?: string;
}

export interface KnowledgeValidationResult {
  valid: boolean;
  issues: KnowledgeValidationIssue[];
}

export function validateProjectKnowledge(markdown: string): KnowledgeValidationResult {
  const issues: KnowledgeValidationIssue[] = [];

  for (const section of REQUIRED_PROJECT_KNOWLEDGE_SECTIONS) {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^##\\s+${escaped}\\s*$`, 'im').test(markdown)) {
      issues.push({
        code: 'missing-section',
        section,
        message: `missing required section: ## ${section}`
      });
    }
  }

  const placeholders = markdown.match(/\[[^\]\n]+\]/g) ?? [];
  for (const placeholder of placeholders) {
    issues.push({
      code: 'placeholder',
      message: `unresolved placeholder: ${placeholder}`
    });
  }

  return { valid: issues.length === 0, issues };
}
