import { renderSlackRunSummary } from '@qali/reporting';
import { boundFetch } from './fetch.js';
import type { Correlation, SlackPort, SlackRunSummary } from './types.js';

interface SlackResponse {
  ok?: boolean;
  ts?: string;
  error?: string;
}

function actionPayload(correlation: Correlation, summary: SlackRunSummary) {
  const snapshot = {
    runId: summary.runId,
    status: summary.status,
    ...(summary.conclusion ? { conclusion: summary.conclusion } : {}),
    ...(summary.intent ? { intent: summary.intent } : {}),
    ...(summary.projectId ? { projectId: summary.projectId } : {}),
    ...(summary.suiteLabel ? { suiteLabel: summary.suiteLabel } : {}),
    ...(summary.counts ?? {}),
    ...(summary.errors?.length
      ? {
          errors: summary.errors
            .slice(0, 3)
            .map((error) => (error.length > 120 ? `${error.slice(0, 117)}…` : error))
        }
      : {}),
    ...(summary.htmlUrl ? { htmlUrl: summary.htmlUrl } : {}),
    ...(summary.stages ? { stages: summary.stages } : {})
  };
  const expandValue = JSON.stringify({
    requestId: correlation.requestId,
    runId: summary.runId,
    summary: snapshot
  });
  const controlValue = JSON.stringify({
    requestId: correlation.requestId,
    runId: summary.runId
  });
  return renderSlackRunSummary(
    {
      runId: summary.runId,
      status: summary.status,
      ...(summary.conclusion ? { conclusion: summary.conclusion } : {}),
      ...(summary.intent ? { intent: summary.intent } : {}),
      ...(summary.projectId ? { projectId: summary.projectId } : {}),
      ...(summary.suiteLabel ? { suiteLabel: summary.suiteLabel } : {}),
      ...(summary.counts ?? {}),
      ...(summary.errors?.length
        ? {
            errors: summary.errors
              .slice(0, 3)
              .map((error) => (error.length > 160 ? `${error.slice(0, 157)}…` : error))
          }
        : {}),
      ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
      ...(summary.stages ? { stages: summary.stages } : {})
    },
    {
      ...(summary.htmlUrl ? { detailsUrl: summary.htmlUrl } : {}),
      expandValue,
      rerunValue: controlValue,
      triageValue: controlValue,
      expanded: Boolean(summary.expanded)
    }
  );
}

export class SlackWebClient implements SlackPort {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = boundFetch
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
    const rendered = actionPayload(correlation, summary);
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
    const rendered = actionPayload(correlation, summary);
    await this.call('chat.update', {
      channel: correlation.channelId,
      ts: responseTs,
      ...rendered
    });
  }

  async postThreadNotice(input: {
    channelId: string;
    threadTs: string;
    text: string;
  }): Promise<string | undefined> {
    try {
      const result = await this.call('chat.postMessage', {
        channel: input.channelId,
        thread_ts: input.threadTs,
        text: input.text
      });
      return result.ts;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const result = await this.call('chat.postMessage', {
        channel: input.channelId,
        text: `${input.text}\n_(Could not reply in-thread: ${detail.slice(0, 120)})_`
      });
      return result.ts;
    }
  }

  async updateThreadNotice(input: { channelId: string; ts: string; text: string }): Promise<void> {
    await this.call('chat.update', {
      channel: input.channelId,
      ts: input.ts,
      text: input.text
    });
  }

  async publishHome(userId: string, view: Record<string, unknown>): Promise<void> {
    await this.call('views.publish', { user_id: userId, view });
  }
}
