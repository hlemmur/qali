const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const encoder = new TextEncoder();

export const REPORT_ACCESS_TTL_SECONDS = 14 * 24 * 60 * 60;
export const HTML_REPORT_MAX_CHARS = 512_000;

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

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToHex(new Uint8Array(digest));
}

export function parseReportKey(key: string): { projectId: string; runId: string } {
  const match = key.match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)\/([a-zA-Z0-9][a-zA-Z0-9._-]*)\.html$/);
  if (!match?.[1] || !match[2]) {
    throw new Error('Invalid report key');
  }
  return { projectId: match[1], runId: match[2] };
}

export function reportObjectKey(projectId: string, runId: string): string {
  if (!SAFE_ID.test(projectId)) throw new Error('Invalid project id for report key');
  if (!SAFE_ID.test(runId)) throw new Error('Invalid run id for report key');
  return `${projectId}/${runId}.html`;
}

export async function signReportAccess(input: {
  baseUrl: string;
  key: string;
  secret: string;
  expiresAtSeconds: number;
}): Promise<{ url: string; signature: string }> {
  parseReportKey(input.key);
  const signature = await hmacHex(input.secret, `${input.key}.${input.expiresAtSeconds}`);
  const base = input.baseUrl.replace(/\/+$/, '');
  return {
    signature,
    url: `${base}/reports/${input.key}?exp=${input.expiresAtSeconds}&sig=${signature}`
  };
}

export async function verifyReportAccess(input: {
  key: string;
  secret: string;
  expiresAtSeconds: number;
  signature: string;
  nowSeconds: number;
}): Promise<boolean> {
  try {
    parseReportKey(input.key);
  } catch {
    return false;
  }
  if (!Number.isInteger(input.expiresAtSeconds) || input.nowSeconds > input.expiresAtSeconds) {
    return false;
  }
  if (!input.signature) return false;
  const expected = await hmacHex(input.secret, `${input.key}.${input.expiresAtSeconds}`);
  return constantTimeEqual(expected, input.signature);
}

export function isHostedHtmlReport(html: string): boolean {
  const trimmed = html.trimStart();
  return (
    html.length > 0 &&
    html.length <= HTML_REPORT_MAX_CHARS &&
    /^(?:<!DOCTYPE html>|<html\b)/i.test(trimmed) &&
    !/<script/i.test(html)
  );
}
