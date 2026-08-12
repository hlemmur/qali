import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRuntimeSkillAssets } from './skill-assets.js';

describe('reviewed runtime skill assets', () => {
  it('loads only full assets whose content, provenance, license, and audit metadata verify', () => {
    const assets = loadRuntimeSkillAssets('skills/runtime');

    expect(assets).toHaveLength(18);
    expect(assets.map((asset) => asset.id)).toContain('qa-project-context');
    for (const asset of assets) {
      expect(asset.content).toMatch(/^---\n[\s\S]+\n---\n/);
      expect(asset.content.split('\n').length).toBeGreaterThan(50);
      expect(asset.provenance.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(asset.provenance.sourceContentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.provenance.vendoredContentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.provenance.license).toBe('MIT');
      expect(asset.provenance.securityAudit.status).toBe('approved');
      expect(asset.provenance.reviewedBy).toBe('Qali');
    }
  });

  it('rejects a vendored skill when its reviewed content changes', () => {
    expect(() =>
      loadRuntimeSkillAssets('skills/runtime', {
        readFile(path) {
          const content = readFileSync(path, 'utf8');
          return path.endsWith('SKILL.md') ? `${content}\nUnreviewed mutation` : content;
        }
      })
    ).toThrow();
  });
});
