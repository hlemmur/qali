import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectExecutionProfileSchema } from '@qali/contracts';

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

export interface ScaffoldProjectOptions {
  projectsRoot: string | URL;
  templateRoot: string | URL;
  date?: string;
}

export interface ScaffoldProjectResult {
  projectId: string;
  projectRoot: string;
}

const localPath = (path: string | URL): string =>
  path instanceof URL ? fileURLToPath(path) : path;

const generatedHeaderPattern =
  /^<!-- qali:generated owner=qali sha256=([a-f0-9]{64}) -->([\s\S]*)$/;
const generatedYamlCommentPattern =
  /^# qali:generated owner=qali sha256=([a-f0-9]{64})\n([\s\S]*)$/;

type GeneratedMarkerKind = 'html' | 'yaml-comment';

export function parseGeneratedMarker(
  content: string
): { kind: GeneratedMarkerKind; hash: string; body: string } | undefined {
  const html = generatedHeaderPattern.exec(content);
  if (html) return { kind: 'html', hash: html[1]!, body: html[2]! };
  const yaml = generatedYamlCommentPattern.exec(content);
  if (yaml) return { kind: 'yaml-comment', hash: yaml[1]!, body: yaml[2]! };
  return undefined;
}

function renderGeneratedMarker(kind: GeneratedMarkerKind, body: string): string {
  if (kind === 'yaml-comment') return renderGeneratedYamlDocument(body);
  const normalized = body.startsWith('\n') ? body : `\n${body}`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `<!-- qali:generated owner=qali sha256=${hash} -->${normalized}`;
}

const generatedJsonHash = (value: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function renderGeneratedJson(value: object): string {
  const body: Record<string, unknown> = { ...value };
  delete body._qali;
  return `${JSON.stringify(
    {
      _qali: { generated: 'owner=qali', sha256: generatedJsonHash(body) },
      ...body
    },
    null,
    2
  )}\n`;
}

export function generatedDocumentBody(content: string): string | undefined {
  return parseGeneratedMarker(content)?.body;
}

export function renderGeneratedDocument(body: string): string {
  return renderGeneratedMarker('html', body);
}

export function renderGeneratedYamlDocument(body: string): string {
  const normalized = body.endsWith('\n') ? body : `${body}\n`;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `# qali:generated owner=qali sha256=${hash}\n${normalized}`;
}

export const REQUIRED_PROJECT_PATHS = [
  'execution-profile.json',
  'sources/project-context.md',
  'sources/reference/requirements.md',
  'sources/reference/journeys.md',
  'sources/reference/risks.md',
  'sources/questions.md',
  'sources/decisions.md',
  'sources/reference/test-data.md',
  'sources/autonomy-policy.md',
  'observations/exploration.md',
  'observations/known-issues.md',
  'observations/evidence/index.md',
  'derived/strategy.md',
  'derived/plan.md',
  'derived/scenarios/.generated.md',
  'derived/coverage/.generated.md',
  'derived/reports/.generated.md',
  'derived/tasks/.generated.md',
  'derived/jobs/.generated.md',
  'derived/workflow-state/.generated.md',
  'derived/workflow-state/schedule.yaml',
  'tests/README.md'
] as const;

const GENERATED_PROJECT_PATHS = REQUIRED_PROJECT_PATHS.filter((path) =>
  path.startsWith('derived/')
);

export interface ProjectValidationIssue {
  code:
    | 'missing-required-file'
    | 'invalid-execution-profile'
    | 'invalid-generated-marker'
    | 'modified-generated-file'
    | 'generated-marker-in-source';
  path: string;
  message: string;
}

export interface ProjectValidationResult {
  valid: boolean;
  issues: ProjectValidationIssue[];
}

function renderProjectTree(directory: string, projectId: string, date: string): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      renderProjectTree(path, projectId, date);
      continue;
    }

    let content = readFileSync(path, 'utf8')
      .replaceAll('{{PROJECT_ID}}', projectId)
      .replaceAll('{{DATE}}', date);
    if (content.includes('sha256={{CONTENT_SHA256}}')) {
      const marker = parseGeneratedMarker(content.replace('{{CONTENT_SHA256}}', '0'.repeat(64)));
      const body = marker?.body ?? content.slice(content.indexOf('\n'));
      const hash = createHash('sha256').update(body).digest('hex');
      content = content.replace('{{CONTENT_SHA256}}', hash);
    }
    writeFileSync(path, content);
  }
}

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

export function scaffoldProject(
  projectId: string,
  options: ScaffoldProjectOptions
): ScaffoldProjectResult {
  if (projectId.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) {
    throw new Error(
      'invalid project id: use 1-64 lowercase letters, numbers, or single hyphen-separated words'
    );
  }

  const projectsRoot = localPath(options.projectsRoot);
  const projectRoot = join(projectsRoot, projectId);
  if (existsSync(projectRoot)) {
    throw new Error(`project already exists: ${projectId}`);
  }
  cpSync(localPath(options.templateRoot), projectRoot, { recursive: true });
  renderProjectTree(projectRoot, projectId, options.date ?? new Date().toISOString().slice(0, 10));
  return { projectId, projectRoot };
}

export function validateProjectDirectory(projectRoot: string | URL): ProjectValidationResult {
  const root = localPath(projectRoot);
  const issues: ProjectValidationIssue[] = [];

  for (const relativePath of REQUIRED_PROJECT_PATHS) {
    if (!existsSync(join(root, relativePath))) {
      issues.push({
        code: 'missing-required-file',
        path: relativePath,
        message: `missing required project file: ${relativePath}`
      });
    }
  }

  const executionProfilePath = join(root, 'execution-profile.json');
  if (existsSync(executionProfilePath)) {
    try {
      const profile = ProjectExecutionProfileSchema.parse(
        JSON.parse(readFileSync(executionProfilePath, 'utf8'))
      );
      const projectId = root.split(/[\\/]/).filter(Boolean).at(-1);
      if (profile.projectId !== projectId) {
        throw new Error(`profile projectId ${profile.projectId} does not match ${projectId}`);
      }
    } catch (error) {
      issues.push({
        code: 'invalid-execution-profile',
        path: 'execution-profile.json',
        message: `invalid execution profile: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  const generatedPaths = new Set([
    ...GENERATED_PROJECT_PATHS,
    ...filesBelow(join(root, 'derived'))
      .map((path) => relative(root, path))
      .filter((path) => /\.(?:md|json|ya?ml)$/.test(path))
  ]);

  for (const relativePath of generatedPaths) {
    const path = join(root, relativePath);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    if (relativePath.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const marker = parsed._qali as Record<string, unknown> | undefined;
        const body = { ...parsed };
        delete body._qali;
        if (
          marker?.generated !== 'owner=qali' ||
          typeof marker.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(marker.sha256)
        ) {
          throw new Error('invalid marker');
        }
        if (marker.sha256 !== generatedJsonHash(body)) {
          issues.push({
            code: 'modified-generated-file',
            path: relativePath,
            message: `generated file content changed without regeneration: ${relativePath}`
          });
        }
      } catch {
        if (
          !issues.some(
            (issue) => issue.path === relativePath && issue.code === 'modified-generated-file'
          )
        ) {
          issues.push({
            code: 'invalid-generated-marker',
            path: relativePath,
            message: `missing or invalid Qali generated marker: ${relativePath}`
          });
        }
      }
      continue;
    }
    const match = parseGeneratedMarker(content);
    if (!match) {
      issues.push({
        code: 'invalid-generated-marker',
        path: relativePath,
        message: `missing or invalid Qali generated marker: ${relativePath}`
      });
      continue;
    }
    const expectedHash = createHash('sha256').update(match.body).digest('hex');
    if (match.hash !== expectedHash) {
      issues.push({
        code: 'modified-generated-file',
        path: relativePath,
        message: `generated file content changed without regeneration: ${relativePath}`
      });
    }
  }

  for (const path of filesBelow(join(root, 'sources'))) {
    if (readFileSync(path, 'utf8').startsWith('<!-- qali:generated ')) {
      const relativePath = relative(root, path);
      issues.push({
        code: 'generated-marker-in-source',
        path: relativePath,
        message: `governed source must not be marked as generated: ${relativePath}`
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Recompute Qali ownership hashes for derived markdown/JSON after agent or Prettier edits.
 * Returns the number of files whose markers were refreshed.
 */
export function refreshGeneratedMarkers(projectRoot: string | URL): number {
  const root = typeof projectRoot === 'string' ? projectRoot : fileURLToPath(projectRoot);
  const generatedPaths = new Set([
    ...GENERATED_PROJECT_PATHS,
    ...filesBelow(join(root, 'derived'))
      .map((path) => relative(root, path))
      .filter((path) => /\.(?:md|json|ya?ml)$/.test(path))
  ]);

  let updated = 0;
  for (const relativePath of generatedPaths) {
    const path = join(root, relativePath);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    if (relativePath.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const body = { ...parsed };
        delete body._qali;
        const next = renderGeneratedJson(body);
        if (next !== content) {
          writeFileSync(path, next);
          updated += 1;
        }
      } catch {
        // Leave invalid JSON for project:validate to report.
      }
      continue;
    }
    const match = parseGeneratedMarker(content);
    const kind: GeneratedMarkerKind =
      match?.kind ?? (/\.ya?ml$/i.test(relativePath) ? 'yaml-comment' : 'html');
    const body = match?.body ?? content;
    const next = renderGeneratedMarker(kind, body);
    if (next === content) continue;
    writeFileSync(path, next);
    updated += 1;
  }
  return updated;
}
