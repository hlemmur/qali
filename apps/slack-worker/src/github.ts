import { NormalizedCommandSchema, type NormalizedCommand } from '@qali/contracts';
import { boundFetch } from './fetch.js';
import type { DispatchResult, GitHubPort } from './types.js';

const encoder = new TextEncoder();

function base64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.from([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function encodeTag(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.from([tag]), encodeLength(content.length), content);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Wrap PKCS#1 RSAPrivateKey bytes as PKCS#8 PrivateKeyInfo for Web Crypto. */
export function wrapPkcs1ToPkcs8(pkcs1: Uint8Array): ArrayBuffer {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const algorithm = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);
  const privateKey = encodeTag(0x04, pkcs1);
  return toArrayBuffer(encodeTag(0x30, concatBytes(version, algorithm, privateKey)));
}

function decodePemBody(pem: string, begin: string, end: string): Uint8Array {
  const escapedBegin = begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pem.match(new RegExp(`${escapedBegin}([\\s\\S]*?)${escapedEnd}`));
  const body = (match?.[1] ?? '').replace(/\s+/g, '');
  if (!body) {
    throw new Error(`GITHUB_APP_PRIVATE_KEY is missing ${begin} … ${end}`);
  }
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function privateKeyBytes(pem: string): ArrayBuffer {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) {
    return wrapPkcs1ToPkcs8(
      decodePemBody(pem, '-----BEGIN RSA PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----')
    );
  }
  if (/BEGIN PRIVATE KEY/.test(pem)) {
    return toArrayBuffer(
      decodePemBody(pem, '-----BEGIN PRIVATE KEY-----', '-----END PRIVATE KEY-----')
    );
  }
  throw new Error(
    'GITHUB_APP_PRIVATE_KEY must be a PEM private key (BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY)'
  );
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
    private readonly request: typeof fetch = boundFetch
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
    const dispatchedAt = Date.now();
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
    if (response.status !== 204) {
      const data = (await response.json()) as {
        workflow_run_id?: string | number;
        workflow_run?: { id?: string | number; html_url?: string };
      };
      const id = data.workflow_run_id ?? data.workflow_run?.id;
      if (id !== undefined) {
        return {
          runId: String(id),
          ...(data.workflow_run?.html_url ? { htmlUrl: data.workflow_run.html_url } : {})
        };
      }
    }
    return this.findDispatchedRun(token, requestId, trustedCommand.intent, dispatchedAt);
  }

  private async findDispatchedRun(
    token: string,
    requestId: string,
    _intent: string,
    dispatchedAt: number
  ): Promise<DispatchResult> {
    const runsEndpoint = `${this.config.apiUrl}/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/actions/workflows/${encodeURIComponent(this.config.workflowFile)}/runs?event=workflow_dispatch&per_page=10`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 + attempt * 300));
      const response = await this.request(runsEndpoint, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'qali-slack-control',
          'x-github-api-version': '2022-11-28'
        }
      });
      if (!response.ok) continue;
      const data = (await response.json()) as {
        workflow_runs?: Array<{
          id?: number;
          name?: string;
          display_title?: string;
          html_url?: string;
          created_at?: string;
        }>;
      };
      const runs = data.workflow_runs ?? [];
      const match = runs.find((run) => {
        const title = `${run.name ?? ''} ${run.display_title ?? ''}`;
        const created = run.created_at ? Date.parse(run.created_at) : 0;
        return title.includes(requestId) && created >= dispatchedAt - 15_000;
      });
      if (match?.id !== undefined) {
        return {
          runId: String(match.id),
          ...(match.html_url ? { htmlUrl: match.html_url } : {})
        };
      }
    }
    return {};
  }
}
