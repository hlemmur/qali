import type { ExternalRole, NormalizedCommand, SlackCorrelationContext } from '@qali/contracts';
import type { D1Database } from '@cloudflare/workers-types';

export interface QueueSender {
  send(message: InboundWork): Promise<void>;
}

export interface WorkersAi {
  run(
    model: string,
    input: {
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      response_format: { type: 'json_schema'; json_schema: unknown };
    }
  ): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  INBOUND_QUEUE: QueueSender;
  AI?: WorkersAi;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  SLACK_BOT_USER_ID?: string;
  SLACK_ALLOWED_TEAM_IDS?: string;
  SLACK_ALLOWED_CHANNEL_IDS?: string;
  SLACK_ALLOWED_USER_IDS?: string;
  SLACK_QA_LEAD_USER_IDS?: string;
  INTENT_MODEL?: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW_FILE: string;
  GITHUB_REF?: string;
  GITHUB_API_URL?: string;
}

export interface InboundWork {
  identity: string;
  requestId: string;
  kind: 'message' | 'action';
  text: string;
  actionId?: string;
  actionValue?: string;
  requestedBy: string;
  externalRole: ExternalRole;
  receivedAt: string;
  slack: SlackCorrelationContext;
}

export interface Correlation {
  requestId: string;
  workflowId?: string;
  runId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  teamId: string;
  channelId: string;
  userId: string;
  threadTs: string;
  requestTs: string;
  responseTs?: string;
  lastError?: string;
}

export interface ControlStore {
  accept(work: InboundWork): Promise<boolean>;
  claim(requestId: string): Promise<boolean>;
  requeue(requestId: string): Promise<void>;
  markDispatched(requestId: string, command: NormalizedCommand, runId?: string): Promise<void>;
  findByRunId(runId: string): Promise<Correlation | null>;
  markCompleted(
    requestId: string,
    status: string,
    responseTs?: string,
    lastError?: string
  ): Promise<void>;
}

export interface IntentClassifier {
  classify(work: InboundWork): Promise<NormalizedCommand>;
}

export interface DispatchResult {
  runId?: string;
  htmlUrl?: string;
}

export interface GitHubPort {
  dispatch(command: NormalizedCommand, requestId: string): Promise<DispatchResult>;
}

export interface SlackPort {
  postResult(correlation: Correlation, summary: SlackRunSummary): Promise<string>;
  updateResult(
    correlation: Correlation,
    responseTs: string,
    summary: SlackRunSummary
  ): Promise<void>;
  postThreadNotice(input: { channelId: string; threadTs: string; text: string }): Promise<void>;
}

export interface SlackRunSummary {
  runId: string;
  status: string;
  conclusion?: string;
  htmlUrl?: string;
  reportUrl?: string;
  counts?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}
