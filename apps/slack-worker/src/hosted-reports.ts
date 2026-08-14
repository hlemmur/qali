import {
  HTML_REPORT_MAX_CHARS,
  REPORT_ACCESS_TTL_SECONDS,
  REPORT_ATTACHMENT_MAX_BYTES,
  REPORT_ATTACHMENT_MAX_COUNT,
  contentTypeForReportAsset,
  isHostedHtmlReport,
  parseReportKey,
  reportAssetObjectKey,
  reportObjectKey,
  signReportAccess,
  verifyReportAccess
} from '@qali/reporting';
import { verifyCallbackRequest } from './security.js';
import type { ControlStore, Env } from './types.js';

function json(status: number, value: unknown): Response {
  return Response.json(value, { status });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

function attachmentList(value: unknown): Array<{ filename: string; data: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as { filename?: unknown; data?: unknown };
    if (typeof item.filename !== 'string' || typeof item.data !== 'string') return [];
    return [{ filename: item.filename, data: item.data }];
  });
}

export async function uploadHostedReport(
  request: Request,
  env: Env,
  store: ControlStore,
  now: Date
): Promise<Response> {
  if (!env.REPORTS) {
    return new Response('Report storage is not configured', { status: 503 });
  }
  const raw = await request.text();
  const authentication = await verifyCallbackRequest({
    secret: env.QALI_CALLBACK_SECRET,
    body: raw,
    signature: request.headers.get('x-qali-signature'),
    timestamp: request.headers.get('x-qali-timestamp'),
    nonce: request.headers.get('x-qali-nonce'),
    nowSeconds: Math.floor(now.getTime() / 1000)
  });
  if (!authentication.valid) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!(await store.acceptCallback(authentication.identity, now.toISOString()))) {
    return json(200, { ok: true, skipped: 'replay' });
  }
  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(raw));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const html = typeof payload.html === 'string' ? payload.html : '';
  if (!isHostedHtmlReport(html)) {
    return new Response(
      `HTML report must be self-contained and under ${HTML_REPORT_MAX_CHARS} characters`,
      {
        status: 400
      }
    );
  }
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : '';
  const runId = payload.runId !== undefined ? String(payload.runId) : '';
  let key: string;
  try {
    key = reportObjectKey(projectId, runId);
  } catch {
    return new Response('Invalid project or run id', { status: 400 });
  }
  const attachments = attachmentList(payload.attachments);
  if (attachments.length > REPORT_ATTACHMENT_MAX_COUNT) {
    return new Response('Too many report attachments', { status: 400 });
  }
  const storedAttachments: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const attachment of attachments) {
    try {
      reportAssetObjectKey(projectId, runId, attachment.filename);
    } catch {
      return new Response('Invalid report attachment name', { status: 400 });
    }
    const bytes = decodeBase64(attachment.data);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > REPORT_ATTACHMENT_MAX_BYTES) {
      return new Response('Invalid report attachment payload', { status: 400 });
    }
    storedAttachments.push({ filename: attachment.filename, bytes });
  }
  await env.REPORTS.put(key, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' }
  });
  for (const attachment of storedAttachments) {
    await env.REPORTS.put(
      reportAssetObjectKey(projectId, runId, attachment.filename),
      attachment.bytes,
      { httpMetadata: { contentType: contentTypeForReportAsset(attachment.filename) } }
    );
  }
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + REPORT_ACCESS_TTL_SECONDS;
  const signed = await signReportAccess({
    baseUrl: new URL(request.url).origin,
    key,
    secret: env.QALI_CALLBACK_SECRET,
    expiresAtSeconds
  });
  return json(200, { ok: true, reportUrl: signed.url, key });
}

export async function serveHostedReport(request: Request, env: Env, now: Date): Promise<Response> {
  if (!env.REPORTS) {
    return new Response('Report storage is not configured', { status: 503 });
  }
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/reports\//, ''));
  const expiresAtSeconds = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';
  const allowed = await verifyReportAccess({
    key,
    secret: env.QALI_CALLBACK_SECRET,
    expiresAtSeconds,
    signature,
    nowSeconds: Math.floor(now.getTime() / 1000)
  });
  if (!allowed) {
    return new Response('Unauthorized', { status: 401 });
  }
  let parsed: ReturnType<typeof parseReportKey>;
  try {
    parsed = parseReportKey(key);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const object = await env.REPORTS.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }
  if (parsed.asset) {
    return new Response(await object.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type': object.httpMetadata?.contentType ?? contentTypeForReportAsset(parsed.asset),
        'cache-control': 'private, max-age=300',
        'content-security-policy': "default-src 'none'; base-uri 'none'",
        'x-content-type-options': 'nosniff'
      }
    });
  }
  return new Response(await object.text(), {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'text/html; charset=utf-8',
      'cache-control': 'private, max-age=300',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'",
      'x-content-type-options': 'nosniff'
    }
  });
}
