import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { loadRuntimeSkillAssets } from './skill-assets.js';
import type { HarnessProfile } from './harness-workspace.js';

const requiredPolicies = [
  'core/policies/operating-model.md',
  'core/policies/evidence-and-provenance.md',
  'core/policies/authority-and-autonomy.md'
];

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value as string[];
}

function safePaths(value: unknown, label: string): string[] {
  const result = strings(value, label);
  if (result.some((path) => isAbsolute(path) || path.split(/[\\/]/).includes('..'))) {
    throw new Error(`${label} contains an unsafe path`);
  }
  return result;
}

export function loadHarnessProfiles(path: string, skillRoot: string): HarnessProfile[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) {
    throw new Error('Invalid harness profile catalog');
  }
  const entries = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('No harness profiles');
  const reviewedSkills = new Set(loadRuntimeSkillAssets(skillRoot).map(({ id }) => id));
  const ids = new Set<string>();
  return entries.map((entry): HarnessProfile => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid harness profile');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item.id)) {
      throw new Error('Invalid harness profile id');
    }
    if (ids.has(item.id)) throw new Error(`Duplicate harness profile ${item.id}`);
    ids.add(item.id);
    const skillIds = strings(item.skillIds, 'skillIds');
    if (skillIds.length === 0 || new Set(skillIds).size !== skillIds.length) {
      throw new Error(`Harness profile ${item.id} has invalid skills`);
    }
    for (const skill of skillIds) {
      if (!reviewedSkills.has(skill)) throw new Error(`Unreviewed skill ${skill}`);
    }
    const policyPaths = safePaths(item.policyPaths, 'policyPaths');
    if (requiredPolicies.some((policy) => !policyPaths.includes(policy))) {
      throw new Error(`Harness profile ${item.id} lacks always-on policy`);
    }
    const writableOutputDirectories = safePaths(
      item.writableOutputDirectories,
      'writableOutputDirectories'
    );
    if (
      writableOutputDirectories.length === 0 ||
      writableOutputDirectories.some((directory) => !directory.startsWith('outputs/'))
    ) {
      throw new Error(`Harness profile ${item.id} has unsafe outputs`);
    }
    const tools = strings(item.tools, 'tools');
    if (tools.some((tool) => tool !== 'browser') || new Set(tools).size !== tools.length) {
      throw new Error(`Harness profile ${item.id} has excessive tools`);
    }
    return {
      id: item.id,
      skillIds,
      policyPaths,
      templatePaths: safePaths(item.templatePaths, 'templatePaths'),
      writableOutputDirectories,
      tools: tools as Array<'browser'>,
      mutations: strings(item.mutations, 'mutations'),
      validators: strings(item.validators, 'validators')
    };
  });
}
