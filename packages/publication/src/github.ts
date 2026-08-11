import type { GitHubPublicationPort, PublicationChange, PullRequestReference } from './index.js';

export interface GitHubPublicationAdapterOptions {
  token: string;
  owner: string;
  repo: string;
  apiUrl?: string;
  fetcher?: typeof fetch;
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export class GitHubRestPublicationAdapter implements GitHubPublicationPort {
  private readonly fetcher: typeof fetch;
  private readonly apiUrl: string;
  private readonly branchBases = new Map<string, string>();

  constructor(private readonly options: GitHubPublicationAdapterOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.options.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(
        `GitHub publication request failed (${response.status}): ${await response.text()}`
      );
    }
    return object(await response.json());
  }

  private repoPath(suffix: string): string {
    return `/repos/${encodeURIComponent(this.options.owner)}/${encodeURIComponent(this.options.repo)}${suffix}`;
  }

  async createBranch(branch: string, baseBranch: string): Promise<void> {
    if (!branch.startsWith('qali/') || baseBranch !== 'main') {
      throw new Error('publication branches must use qali/* and target main');
    }
    const ref = await this.request(this.repoPath(`/git/ref/heads/${baseBranch}`));
    const sha = object(ref.object).sha;
    if (typeof sha !== 'string') throw new Error('base branch SHA was missing');
    await this.request(this.repoPath('/git/refs'), {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    });
    this.branchBases.set(branch, sha);
  }

  async commit(branch: string, message: string, changes: PublicationChange[]): Promise<void> {
    const parentSha = this.branchBases.get(branch);
    if (!parentSha) throw new Error(`branch was not created by this publisher: ${branch}`);
    const baseCommit = await this.request(this.repoPath(`/git/commits/${parentSha}`));
    const baseTreeSha = object(baseCommit.tree).sha;
    if (typeof baseTreeSha !== 'string') throw new Error('base tree SHA was missing');

    const tree = [];
    for (const change of changes) {
      if (change.deleted || typeof change.content !== 'string') {
        throw new Error(`adapter received an unsafe change: ${change.path}`);
      }
      const blob = await this.request(this.repoPath('/git/blobs'), {
        method: 'POST',
        body: JSON.stringify({
          content: Buffer.from(change.content, 'utf8').toString('base64'),
          encoding: 'base64'
        })
      });
      if (typeof blob.sha !== 'string') throw new Error(`blob SHA was missing: ${change.path}`);
      tree.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const createdTree = await this.request(this.repoPath('/git/trees'), {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree })
    });
    if (typeof createdTree.sha !== 'string') throw new Error('tree SHA was missing');
    const commit = await this.request(this.repoPath('/git/commits'), {
      method: 'POST',
      body: JSON.stringify({ message, tree: createdTree.sha, parents: [parentSha] })
    });
    if (typeof commit.sha !== 'string') throw new Error('commit SHA was missing');
    await this.request(this.repoPath(`/git/refs/heads/${branch}`), {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
  }

  async createPullRequest(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<PullRequestReference> {
    const pull = await this.request(this.repoPath('/pulls'), {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        head: input.branch,
        base: input.baseBranch,
        body: input.body
      })
    });
    if (
      typeof pull.number !== 'number' ||
      typeof pull.node_id !== 'string' ||
      typeof pull.html_url !== 'string'
    ) {
      throw new Error('GitHub pull request response was incomplete');
    }
    return { number: pull.number, nodeId: pull.node_id, url: pull.html_url };
  }

  async enableAutoMerge(pullRequestNodeId: string): Promise<void> {
    await this.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query:
          'mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: $mergeMethod}) { pullRequest { id } } }',
        variables: { pullRequestId: pullRequestNodeId, mergeMethod: 'SQUASH' }
      })
    });
  }
}
