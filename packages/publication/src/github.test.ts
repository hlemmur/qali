import { describe, expect, it } from 'vitest';
import { GitHubRestPublicationAdapter } from './github.js';

describe('least-privilege GitHub publication adapter', () => {
  it('writes only to a Qali branch, opens a PR, and enables squash auto-merge', async () => {
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
      if (url.endsWith('/graphql'))
        return Response.json({ data: { enablePullRequestAutoMerge: {} } });
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
        mutation: 'render-derived-report',
        content: 'report'
      }
    ]);
    const pull = await adapter.createPullRequest({
      branch: 'qali/req-1',
      baseBranch: 'main',
      title: 'Qali updates',
      body: 'checks passed'
    });
    await adapter.enableAutoMerge(pull.nodeId);

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
    expect(requests.at(-1)?.body).toMatchObject({
      variables: { pullRequestId: 'PR_node', mergeMethod: 'SQUASH' }
    });
  });
});
