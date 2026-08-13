import {
  HTML_REPORT_MAX_CHARS,
  REPORT_ACCESS_TTL_SECONDS,
  isHostedHtmlReport,
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
  await env.REPORTS.put(key, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' }
  });
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
  const object = await env.REPORTS.get(key);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }
  return new Response(await object.text(), {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'text/html; charset=utf-8',
      'cache-control': 'private, max-age=300',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'",
      'x-content-type-options': 'nosniff'
    }
  });
}
