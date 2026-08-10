import { renderSlackRunSummary } from '@qali/reporting';
import type { Correlation, SlackPort, SlackRunSummary } from './types.js';

interface SlackResponse {
  ok?: boolean;
  ts?: string;
  error?: string;
}

function payload(correlation: Correlation, summary: SlackRunSummary) {
  return renderSlackRunSummary(
    {
      runId: summary.runId,
      status: summary.conclusion ?? summary.status,
      ...(summary.counts ?? {})
    },
    {
      ...(summary.htmlUrl ? { detailsUrl: summary.htmlUrl } : {}),
      ...(summary.reportUrl ? { reportUrl: summary.reportUrl } : {}),
      rerunValue: JSON.stringify({ requestId: correlation.requestId, runId: summary.runId }),
      triageValue: JSON.stringify({ requestId: correlation.requestId, runId: summary.runId })
    }
  );
}

export class SlackWebClient implements SlackPort {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch
  ) {}

  private async call(method: string, body: Record<string, unknown>): Promise<SlackResponse> {
    const response = await this.request(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as SlackResponse;
    if (!response.ok || !result.ok) {
      throw new Error(`Slack ${method} failed: ${result.error ?? response.status}`);
    }
    return result;
  }

  async postResult(correlation: Correlation, summary: SlackRunSummary): Promise<string> {
    const rendered = payload(correlation, summary);
    const result = await this.call('chat.postMessage', {
      channel: correlation.channelId,
      thread_ts: correlation.threadTs,
      ...rendered
    });
    if (!result.ts) throw new Error('Slack did not return a message timestamp');
    return result.ts;
  }

  async updateResult(
    correlation: Correlation,
    responseTs: string,
    summary: SlackRunSummary
  ): Promise<void> {
    const rendered = payload(correlation, summary);
    await this.call('chat.update', {
      channel: correlation.channelId,
      ts: responseTs,
      ...rendered
    });
  }
}
