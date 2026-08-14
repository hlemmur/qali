import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { encryptGitHubSecret } from './github-secret.js';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

describe('GitHub environment secret encryption', () => {
  it('seals plaintext so libsodium crypto_box_seal_open can recover it', async () => {
    const sodium = (await import('libsodium-wrappers')).default;
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);
    const sealed = encryptGitHubSecret('{"password":"secret_sauce"}', publicKey);
    const opened = sodium.crypto_box_seal_open(
      fromBase64(sealed),
      keyPair.publicKey,
      keyPair.privateKey
    );
    expect(new TextDecoder().decode(opened)).toBe('{"password":"secret_sauce"}');
    expect(sealed).not.toContain('secret_sauce');
  });

  it('rejects a public key that is not a 32-byte curve25519 key', () => {
    const short = toBase64(nacl.randomBytes(16));
    expect(() => encryptGitHubSecret('{}', short)).toThrow(/public key/i);
  });
});
