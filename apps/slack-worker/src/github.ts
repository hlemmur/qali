import { NormalizedCommandSchema, type NormalizedCommand } from '@qali/contracts';
import type { DispatchResult, GitHubPort } from './types.js';

const encoder = new TextEncoder();

function base64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function privateKeyBytes(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

export async function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ iss: appId, iat: nowSeconds - 60, exp: nowSeconds + 540 })
  );
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(signature)}`;
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
  apiUrl: string;
}

export class GitHubAppClient implements GitHubPort {
  constructor(
    private readonly config: GitHubAppConfig,
    private readonly request: typeof fetch = fetch
  ) {}

  private async installationToken(): Promise<string> {
    const jwt = await createGitHubAppJwt(this.config.appId, this.config.privateKey);
    const response = await this.request(
      `${this.config.apiUrl}/app/installations/${encodeURIComponent(this.config.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${jwt}`,
          'user-agent': 'qali-slack-control',
          'x-github-api-version': '2022-11-28'
        }
      }
    );
    if (!response.ok)
      throw new Error(`GitHub installation token exchange failed: ${response.status}`);
    const data = (await response.json()) as { token?: unknown };
    if (typeof data.token !== 'string')
      throw new Error('GitHub installation token response was invalid');
    return data.token;
  }

  async dispatch(command: NormalizedCommand, requestId: string): Promise<DispatchResult> {
    const trustedCommand = NormalizedCommandSchema.parse(command);
    const token = await this.installationToken();
    const endpoint = `${this.config.apiUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/actions/workflows/${encodeURIComponent(this.config.workflowFile)}/dispatches`;
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'qali-slack-control',
        'x-github-api-version': '2022-11-28'
      },
      body: JSON.stringify({
        ref: this.config.ref,
        return_run_details: true,
        inputs: {
          request_id: requestId,
          correlation_json: JSON.stringify(trustedCommand.slack ?? {}),
          project_json: JSON.stringify(trustedCommand.project),
          intent: trustedCommand.intent,
          parameters_json: JSON.stringify(trustedCommand.parameters),
          command_json: JSON.stringify(trustedCommand)
        }
      })
    });
    if (!response.ok) throw new Error(`GitHub workflow dispatch failed: ${response.status}`);
    if (response.status === 204) return {};
    const data = (await response.json()) as {
      workflow_run_id?: string | number;
      workflow_run?: { id?: string | number; html_url?: string };
    };
    const id = data.workflow_run_id ?? data.workflow_run?.id;
    return {
      ...(id !== undefined ? { runId: String(id) } : {}),
      ...(data.workflow_run?.html_url ? { htmlUrl: data.workflow_run.html_url } : {})
    };
  }
}
