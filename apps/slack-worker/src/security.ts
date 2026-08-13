const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function signHmacForTest(
  secret: string,
  content: string,
  prefix = ''
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(content));
  return `${prefix}${bytesToHex(new Uint8Array(digest))}`;
}

export interface SignedRequest {
  secret: string;
  body: string;
  signature: string | null;
  timestamp?: string | null;
  nowSeconds: number;
  prefix: string;
  replayWindowSeconds?: number;
}

export async function verifySignedRequest(input: SignedRequest): Promise<boolean> {
  if (!input.signature) return false;
  if (input.timestamp !== undefined) {
    const timestamp = Number(input.timestamp);
    if (
      !Number.isInteger(timestamp) ||
      Math.abs(input.nowSeconds - timestamp) > (input.replayWindowSeconds ?? 300)
    ) {
      return false;
    }
  }
  const signed = input.timestamp ? `v0:${input.timestamp}:${input.body}` : input.body;
  const expected = await signHmacForTest(input.secret, signed, input.prefix);
  return constantTimeEqual(expected, input.signature);
}

export interface CallbackRequest {
  secret: string;
  body: string;
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  nowSeconds: number;
  replayWindowSeconds?: number;
}

export async function verifyCallbackRequest(
  input: CallbackRequest
): Promise<{ valid: true; identity: string } | { valid: false }> {
  if (!input.signature || !input.timestamp || !input.nonce) return { valid: false };
  const timestamp = Number(input.timestamp);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(input.nowSeconds - timestamp) > (input.replayWindowSeconds ?? 300)
  ) {
    return { valid: false };
  }
  const expected = await signHmacForTest(
    input.secret,
    `${input.timestamp}.${input.nonce}.${input.body}`,
    'sha256='
  );
  return constantTimeEqual(expected, input.signature)
    ? { valid: true, identity: `${input.timestamp}:${input.nonce}` }
    : { valid: false };
}
