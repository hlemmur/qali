import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from '@qali/reporting';
import type { QualitySnapshot } from '@qali/contracts';
import { signHmacForTest } from './security.js';
import { createWorker } from './index.js';
import type { ControlStore, Correlation, Env } from './types.js';

class MemoryStore implements ControlStore {
  readonly callbacks = new Set<string>();
  readonly correlations = new Map<string, Correlation>();

  async accept(): Promise<boolean> {
    return true;
  }
  async acceptCallback(identity: string): Promise<boolean> {
    if (this.callbacks.has(identity)) return false;
    this.callbacks.add(identity);
    return true;
  }
  async recordSecurityDenial(): Promise<void> {}
  async consumeRateLimit(): Promise<'accepted'> {
    return 'accepted';
  }
  async purgeExpired(): Promise<number> {
    return 0;
  }
  async claim(): Promise<boolean> {
    return true;
  }
  async requeue(): Promise<void> {}
  async markDispatched(): Promise<void> {}
  async findByRunId(): Promise<Correlation | null> {
    return null;
  }
  async findByRequestId(requestId: string): Promise<Correlation | null> {
    return this.correlations.get(requestId) ?? null;
  }
  async markCompleted(): Promise<void> {}
  async getQualitySnapshot(): Promise<QualitySnapshot | null> {
    return null;
  }
  async upsertQualitySnapshot(): Promise<void> {}
  async listWorkForUser(): Promise<Correlation[]> {
    return [];
  }
}

class MemoryR2 {
  readonly objects = new Map<string, { body: string; contentType?: string }>();

  async put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<{ key: string }> {
    this.objects.set(key, {
      body: value,
      ...(options?.httpMetadata?.contentType
        ? { contentType: options.httpMetadata.contentType }
        : {})
    });
    return { key };
  }

  async get(key: string): Promise<{
    body: string;
    text: () => Promise<string>;
    httpMetadata?: { contentType?: string };
  } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: object.body,
      text: async () => object.body,
      ...(object.contentType ? { httpMetadata: { contentType: object.contentType } } : {})
    };
  }
}

const html = renderHtmlReport({
  runId: '42',
  status: 'failed',
  intent: 'explore-project',
  projectId: 'sauce-demo',
  errors: ['Login did not reach inventory']
});

function envWithReports(reports?: MemoryR2): Env {
  return {
    INBOUND_QUEUE: { send: async () => undefined },
    SLACK_SIGNING_SECRET: 'slack-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
    GITHUB_WEBHOOK_SECRET: 'github-secret',
    QALI_CALLBACK_SECRET: 'callback-secret',
    ...(reports ? { REPORTS: reports } : {})
  } as unknown as Env;
}

async function signedReportRequest(body: string, nonce = 'report-42-1'): Promise<Request> {
  const timestamp = '1700000000';
  const signature = await signHmacForTest(
    'callback-secret',
    `${timestamp}.${nonce}.${body}`,
    'sha256='
  );
  return new Request('https://worker.test/github/report', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qali-timestamp': timestamp,
      'x-qali-nonce': nonce,
      'x-qali-signature': signature
    },
    body
  });
}

describe('hosted HTML reports', () => {
  const now = () => new Date('2023-11-14T22:13:20.000Z');

  it('rejects GET reports without a valid signature', async () => {
    const worker = createWorker({ store: new MemoryStore(), now });
    const response = await worker.fetch(
      new Request('https://worker.test/reports/sauce-demo/42.html'),
      envWithReports(new MemoryR2())
    );
    expect(response.status).toBe(401);
  });

  it('returns 503 when R2 is not bound', async () => {
    const worker = createWorker({ store: new MemoryStore(), now });
    const body = JSON.stringify({
      requestId: 'Ev1',
      runId: '42',
      projectId: 'sauce-demo',
      html
    });
    expect((await worker.fetch(await signedReportRequest(body), envWithReports())).status).toBe(
      503
    );
  });

  it('uploads HTML to R2 and serves it from a signed URL', async () => {
    const reports = new MemoryR2();
    const worker = createWorker({ store: new MemoryStore(), now });
    const body = JSON.stringify({
      requestId: 'Ev1',
      runId: '42',
      projectId: 'sauce-demo',
      html
    });
    const upload = await worker.fetch(await signedReportRequest(body), envWithReports(reports));
    expect(upload.status).toBe(200);
    const payload = (await upload.json()) as { reportUrl?: string };
    expect(payload.reportUrl).toContain('/reports/sauce-demo/42.html');
    expect(payload.reportUrl).toContain('sig=');
    expect(reports.objects.get('sauce-demo/42.html')?.body).toContain(
      'Login did not reach inventory'
    );

    const served = await worker.fetch(new Request(payload.reportUrl!), envWithReports(reports));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toMatch(/text\/html/);
    const page = await served.text();
    expect(page).toContain('Login did not reach inventory');
    expect(page).not.toContain('<script');
  });

  it('rejects script-bearing HTML uploads', async () => {
    const worker = createWorker({ store: new MemoryStore(), now });
    const body = JSON.stringify({
      runId: '42',
      projectId: 'sauce-demo',
      html: '<!DOCTYPE html><html><script>alert(1)</script></html>'
    });
    expect(
      (await worker.fetch(await signedReportRequest(body), envWithReports(new MemoryR2()))).status
    ).toBe(400);
  });

  it('puts Open report on the Slack card when the run summary includes a hosted URL', async () => {
    const store = new MemoryStore();
    const correlation: Correlation = {
      requestId: 'Ev1',
      status: 'running',
      createdAt: '2023-11-14T22:13:20.000Z',
      updatedAt: '2023-11-14T22:13:20.000Z',
      teamId: 'T1',
      channelId: 'C1',
      userId: 'U1',
      threadTs: '1.1',
      requestTs: '1.1'
    };
    store.correlations.set('Ev1', correlation);
    const posted: Array<Record<string, unknown>> = [];
    const worker = createWorker({
      store,
      now,
      slack: {
        postResult: async (_correlation, summary) => {
          posted.push(summary as unknown as Record<string, unknown>);
          return '2.2';
        },
        updateResult: async () => undefined,
        postThreadNotice: async () => undefined
      }
    });
    const body = JSON.stringify({
      requestId: 'Ev1',
      runId: '42',
      status: 'failed',
      htmlUrl: 'https://github.test/runs/42',
      reportUrl: 'https://worker.test/reports/sauce-demo/42.html?exp=1&sig=abc'
    });
    const timestamp = '1700000000';
    const nonce = 'summary-42-1';
    const signature = await signHmacForTest(
      'callback-secret',
      `${timestamp}.${nonce}.${body}`,
      'sha256='
    );
    const response = await worker.fetch(
      new Request('https://worker.test/github/run-summary', {
        method: 'POST',
        headers: {
          'x-qali-timestamp': timestamp,
          'x-qali-nonce': nonce,
          'x-qali-signature': signature
        },
        body
      }),
      envWithReports()
    );
    expect(response.status).toBe(200);
    expect(posted[0]?.reportUrl).toBe(
      'https://worker.test/reports/sauce-demo/42.html?exp=1&sig=abc'
    );
  });
});
