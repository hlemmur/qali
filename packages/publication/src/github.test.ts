import { describe, expect, it } from 'vitest';
import { GitHubRestPublicationAdapter } from './github.js';

describe('least-privilege GitHub publication adapter', () => {
  it('writes only to a Qali branch and opens a review-only PR without auto-merge', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method: init?.method ?? 'GET', body });
      if (url.endsWith('/git/ref/heads/main')) {
        return Response.json({ object: { sha: 'base-sha' } });
      }
      if (url.endsWith('/git/commits/base-sha')) {
        return Response.json({ tree: { sha: 'base-tree' } });
      }
      if (url.endsWith('/git/blobs')) return Response.json({ sha: 'blob-sha' });
      if (url.endsWith('/git/trees')) return Response.json({ sha: 'tree-sha' });
      if (url.endsWith('/git/commits')) return Response.json({ sha: 'commit-sha' });
      if (url.endsWith('/pulls')) {
        return Response.json({
          number: 9,
          node_id: 'PR_node',
          html_url: 'https://github.test/acme/qali/pull/9'
        });
      }
      return Response.json({});
    };
    const adapter = new GitHubRestPublicationAdapter({
      token: 'installation-token',
      owner: 'acme',
      repo: 'qali',
      apiUrl: 'https://github.test',
      fetcher
    });

    await adapter.createBranch('qali/req-1', 'main');
    await adapter.commit('qali/req-1', 'Publish updates', [
      {
        path: 'projects/demo/derived/reports/run.md',
        classification: 'derived-artifact',
        before: null,
        after: { content: 'report', sha256: 'a'.repeat(64) }
      }
    ]);
    await adapter.createPullRequest({
      branch: 'qali/req-1',
      baseBranch: 'main',
      title: 'Qali updates',
      body: 'checks passed'
    });

    expect(requests).toContainEqual(
      expect.objectContaining({
        url: 'https://github.test/repos/acme/qali/git/refs',
        body: { ref: 'refs/heads/qali/req-1', sha: 'base-sha' }
      })
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        url: 'https://github.test/repos/acme/qali/git/refs/heads/qali/req-1',
        method: 'PATCH',
        body: { sha: 'commit-sha', force: false }
      })
    );
    expect(
      requests.some(({ url, method }) => url.includes('/git/refs/heads/main') && method === 'PATCH')
    ).toBe(false);
    expect(requests.some(({ url }) => url.endsWith('/graphql'))).toBe(false);
  });

  it('posts a null blob SHA to retract generated specs and rejects other deletions', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method: init?.method ?? 'GET', body });
      if (url.endsWith('/git/ref/heads/main')) {
        return Response.json({ object: { sha: 'base-sha' } });
      }
      if (url.endsWith('/git/commits/base-sha')) {
        return Response.json({ tree: { sha: 'base-tree' } });
      }
      if (url.endsWith('/git/blobs')) return Response.json({ sha: 'blob-sha' });
      if (url.endsWith('/git/trees')) return Response.json({ sha: 'tree-sha' });
      if (url.endsWith('/git/commits')) return Response.json({ sha: 'commit-sha' });
      return Response.json({});
    };
    const adapter = new GitHubRestPublicationAdapter({
      token: 'installation-token',
      owner: 'acme',
      repo: 'qali',
      apiUrl: 'https://github.test',
      fetcher
    });

    await adapter.createBranch('qali/req-1', 'main');
    await adapter.commit('qali/req-1', 'Retract generated tests', [
      {
        path: 'projects/shop/tests/generated/foo.generated.spec.ts',
        classification: 'test',
        before: { content: 'spec', sha256: 'b'.repeat(64) },
        after: null
      }
    ]);

    expect(requests.some(({ url }) => url.endsWith('/git/blobs'))).toBe(false);
    expect(requests).toContainEqual(
      expect.objectContaining({
        url: 'https://github.test/repos/acme/qali/git/trees',
        method: 'POST',
        body: {
          base_tree: 'base-tree',
          tree: [
            {
              path: 'projects/shop/tests/generated/foo.generated.spec.ts',
              mode: '100644',
              type: 'blob',
              sha: null
            }
          ]
        }
      })
    );

    await expect(
      adapter.commit('qali/req-1', 'Unsafe delete', [
        {
          path: 'projects/shop/derived/reports/run.md',
          classification: 'derived-artifact',
          before: { content: 'report', sha256: 'a'.repeat(64) },
          after: null
        }
      ])
    ).rejects.toThrow(/unsafe change/);
  });

  it('enables squash auto-merge for Qali-owned test publication', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        ...(init?.method ? { method: init.method } : {}),
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {})
      });
      return Response.json({
        data: { enablePullRequestAutoMerge: { pullRequest: { id: 'PR_node' } } }
      });
    };
    const adapter = new GitHubRestPublicationAdapter({
      token: 'installation-token',
      owner: 'qali',
      repo: 'control',
      apiUrl: 'https://github.test',
      fetcher
    });

    await adapter.enableAutoMerge('PR_node');
    expect(requests).toEqual([
      expect.objectContaining({
        url: 'https://github.test/graphql',
        method: 'POST',
        body: expect.objectContaining({
          query: expect.stringMatching(/enablePullRequestAutoMerge/)
        })
      })
    ]);
  });
});
