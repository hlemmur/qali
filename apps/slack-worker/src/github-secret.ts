import nacl from 'tweetnacl';
import { blake2b } from '@noble/hashes/blake2.js';

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

/** GitHub environment secrets use libsodium `crypto_box_seal` over the repo public key. */
export function encryptGitHubSecret(plaintext: string, publicKeyBase64: string): string {
  const publicKey = fromBase64(publicKeyBase64);
  if (publicKey.byteLength !== nacl.box.publicKeyLength) {
    throw new Error('GitHub environment secret public key must be 32 bytes');
  }
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(concat(ephemeral.publicKey, publicKey), { dkLen: nacl.box.nonceLength });
  const boxed = nacl.box(
    new TextEncoder().encode(plaintext),
    nonce,
    publicKey,
    ephemeral.secretKey
  );
  if (!boxed) throw new Error('GitHub environment secret encryption failed');
  return toBase64(concat(ephemeral.publicKey, boxed));
}
