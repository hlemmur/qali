import { describe, expect, it } from 'vitest';
import { signHmacForTest, verifySignedRequest } from './security.js';

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
