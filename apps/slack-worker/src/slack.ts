import type { Correlation, SlackPort, SlackRunSummary } from './types.js';

interface SlackResponse {
  ok?: boolean;
  ts?: string;
  error?: string;
}

function blocks(correlation: Correlation, summary: SlackRunSummary): unknown[] {
  const outcome = summary.conclusion ?? summary.status;
  const actions: unknown[] = [];
  if (summary.htmlUrl) {
    actions.push({
      type: 'button',
      action_id: 'run_details',
      text: { type: 'plain_text', text: 'Details' },
      url: summary.htmlUrl
    });
  }
  actions.push({
    type: 'button',
    action_id: 'rerun_workflow',
    text: { type: 'plain_text', text: 'Rerun' },
    value: JSON.stringify({ requestId: correlation.requestId, runId: summary.runId })
  });
  if (summary.reportUrl) {
    actions.push({
      type: 'button',
      action_id: 'open_report',
      text: { type: 'plain_text', text: 'Report' },
      url: summary.reportUrl
    });
  }
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Qali run ${summary.runId}* · ${outcome}`
      }
    },
    { type: 'actions', elements: actions }
  ];
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
    const result = await this.call('chat.postMessage', {
      channel: correlation.channelId,
      thread_ts: correlation.threadTs,
      text: `Qali run ${summary.runId}: ${summary.conclusion ?? summary.status}`,
      blocks: blocks(correlation, summary)
    });
    if (!result.ts) throw new Error('Slack did not return a message timestamp');
    return result.ts;
  }

  async updateResult(
    correlation: Correlation,
    responseTs: string,
    summary: SlackRunSummary
  ): Promise<void> {
    await this.call('chat.update', {
      channel: correlation.channelId,
      ts: responseTs,
      text: `Qali run ${summary.runId}: ${summary.conclusion ?? summary.status}`,
      blocks: blocks(correlation, summary)
    });
  }
}
