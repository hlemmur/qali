import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface RuntimeSkillProvenance {
  source: string;
  sourcePath: string;
  sourceCommit: string;
  sourceContentHash: string;
  vendoredContentHash: string;
  license: 'MIT';
  licenseFile: string;
  reviewedBy: 'Qali';
  securityAudit: { status: 'approved'; profile: string };
}

export interface RuntimeSkillAsset {
  id: string;
  content: string;
  provenance: RuntimeSkillProvenance;
}

interface SkillAssetIo {
  readFile(path: string): string;
}

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

function assertString(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern && !pattern.test(value))) {
    throw new Error(`Invalid runtime skill ${label}`);
  }
  return value;
}

export function loadRuntimeSkillAssets(
  root: string,
  io: SkillAssetIo = { readFile: (path) => readFileSync(path, 'utf8') }
): RuntimeSkillAsset[] {
  const raw: unknown = JSON.parse(io.readFile(join(root, 'manifest.json')));
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) {
    throw new Error('Invalid runtime skill manifest');
  }
  const entries = (raw as { skills?: unknown }).skills;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Runtime skill manifest must contain skills');
  }
  const ids = new Set<string>();
  const assets = entries.map((entry): RuntimeSkillAsset => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid runtime skill entry');
    const item = entry as Record<string, unknown>;
    const id = assertString(item.id, 'id', /^[a-z][a-z0-9-]*$/);
    if (ids.has(id)) throw new Error(`Duplicate runtime skill ${id}`);
    ids.add(id);
    const content = io.readFile(join(root, id, 'SKILL.md'));
    const sourceContentHash = assertString(item.sourceContentHash, 'source hash', /^[a-f0-9]{64}$/);
    const vendoredContentHash = assertString(
      item.vendoredContentHash,
      'vendored hash',
      /^[a-f0-9]{64}$/
    );
    if (sourceContentHash !== vendoredContentHash || sha256(content) !== vendoredContentHash) {
      throw new Error(`Runtime skill ${id} content does not match reviewed provenance`);
    }
    const license = assertString(item.license, 'license');
    if (license !== 'MIT') throw new Error(`Runtime skill ${id} has unapproved license`);
    const licenseFile = assertString(item.licenseFile, 'license file');
    if (!existsSync(join(root, licenseFile)))
      throw new Error(`Runtime skill ${id} license is missing`);
    const securityAudit = item.securityAudit as Record<string, unknown> | undefined;
    if (securityAudit?.status !== 'approved') {
      throw new Error(`Runtime skill ${id} security review is not approved`);
    }
    const reviewedBy = assertString(item.reviewedBy, 'reviewer');
    if (reviewedBy !== 'Qali') throw new Error(`Runtime skill ${id} is not Qali-reviewed`);
    return {
      id,
      content,
      provenance: {
        source: assertString(item.source, 'source'),
        sourcePath: assertString(item.sourcePath, 'source path'),
        sourceCommit: assertString(item.sourceCommit, 'source commit', /^[a-f0-9]{40}$/),
        sourceContentHash,
        vendoredContentHash,
        license: 'MIT',
        licenseFile,
        reviewedBy: 'Qali',
        securityAudit: {
          status: 'approved',
          profile: assertString(securityAudit.profile, 'security profile')
        }
      }
    };
  });
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'licenses')
    .map((entry) => entry.name)
    .sort();
  if (directories.join('\n') !== [...ids].sort().join('\n')) {
    throw new Error('Runtime skill directory and manifest entries differ');
  }
  return assets;
}
