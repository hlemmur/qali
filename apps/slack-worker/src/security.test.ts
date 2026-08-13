import { describe, expect, it } from 'vitest';
import { signHmacForTest, verifyCallbackRequest, verifySignedRequest } from './security.js';

describe('signed request verification', () => {
  it('accepts an authentic Slack body and rejects tampering and replay', async () => {
    const secret = 'slack-secret';
    const body = '{"type":"event_callback"}';
    const timestamp = '1700000000';
    const signature = await signHmacForTest(secret, `v0:${timestamp}:${body}`, 'v0=');

    await expect(
      verifySignedRequest({
        secret,
        body,
        timestamp,
        signature,
        nowSeconds: 1_700_000_100,
        prefix: 'v0='
      })
    ).resolves.toBe(true);
    await expect(
      verifySignedRequest({
        secret,
        body: `${body} `,
        timestamp,
        signature,
        nowSeconds: 1_700_000_100,
        prefix: 'v0='
      })
    ).resolves.toBe(false);
    await expect(
      verifySignedRequest({
        secret,
        body,
        timestamp,
        signature,
        nowSeconds: 1_700_000_301,
        prefix: 'v0='
      })
    ).resolves.toBe(false);
  });
});

describe('Actions callback authentication', () => {
  it('requires a fresh timestamp and nonce bound into the signature', async () => {
    const body = '{"requestId":"Ev1"}';
    const timestamp = '1700000000';
    const nonce = 'run-42-attempt-1';
    const signature = await signHmacForTest(
      'callback-secret',
      `${timestamp}.${nonce}.${body}`,
      'sha256='
    );

    expect(
      await verifyCallbackRequest({
        secret: 'callback-secret',
        body,
        signature,
        timestamp,
        nonce,
        nowSeconds: 1700000100
      })
    ).toEqual({ valid: true, identity: `${timestamp}:${nonce}` });
    expect(
      await verifyCallbackRequest({
        secret: 'callback-secret',
        body,
        signature,
        timestamp,
        nonce,
        nowSeconds: 1700001000
      })
    ).toEqual({ valid: false });
    expect(
      await verifyCallbackRequest({
        secret: 'callback-secret',
        body,
        signature,
        timestamp,
        nonce: 'different',
        nowSeconds: 1700000100
      })
    ).toEqual({ valid: false });
  });
});
