import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { NormalizedCommand } from '@qali/contracts';
import type { ControlStore, Correlation, InboundWork } from './types.js';

const rowToCorrelation = (row: Record<string, unknown>): Correlation => ({
  requestId: String(row.request_id),
  ...(row.workflow_id ? { workflowId: String(row.workflow_id) } : {}),
  ...(row.run_id ? { runId: String(row.run_id) } : {}),
  status: String(row.status),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  teamId: String(row.team_id),
  channelId: String(row.channel_id),
  userId: String(row.user_id),
  threadTs: String(row.thread_ts),
  requestTs: String(row.request_ts),
  ...(row.response_ts ? { responseTs: String(row.response_ts) } : {}),
  ...(row.last_error ? { lastError: String(row.last_error) } : {}),
  ...(row.command_json ? { commandJson: String(row.command_json) } : {})
});

export class D1ControlStore implements ControlStore {
  constructor(private readonly db: D1Database) {}

  async accept(work: InboundWork): Promise<boolean> {
    const dedupe = this.db
      .prepare(
        'INSERT INTO inbound_deduplication (identity, received_at) VALUES (?, ?) ON CONFLICT(identity) DO NOTHING'
      )
      .bind(work.identity, work.receivedAt);
    const correlation = this.db
      .prepare(
        `INSERT INTO correlations
          (request_id, status, created_at, updated_at, team_id, channel_id, user_id, thread_ts, request_ts)
         VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(request_id) DO NOTHING`
      )
      .bind(
        work.requestId,
        work.receivedAt,
        work.receivedAt,
        work.slack.teamId,
        work.slack.channelId,
        work.requestedBy,
        work.slack.threadTs,
        work.slack.requestTs
      );
    const [result] = await this.db.batch([dedupe, correlation]);
    return (result?.meta.changes ?? 0) === 1;
  }

  async claim(requestId: string): Promise<boolean> {
    const leaseCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const result = await this.db
      .prepare(
        `UPDATE correlations SET status = 'processing', updated_at = ?
         WHERE request_id = ?
           AND (status = 'queued' OR (status = 'processing' AND updated_at < ?))`
      )
      .bind(new Date().toISOString(), requestId, leaseCutoff)
      .run();
    return result.meta.changes === 1;
  }

  async requeue(requestId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE correlations SET status = 'queued', updated_at = ?
         WHERE request_id = ? AND status = 'processing'`
      )
      .bind(new Date().toISOString(), requestId)
      .run();
  }

  async markDispatched(
    requestId: string,
    command: NormalizedCommand,
    runId?: string
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE correlations
         SET workflow_id = ?, run_id = ?, command_json = ?, status = 'dispatched', last_error = NULL, updated_at = ?
         WHERE request_id = ?`
      )
      .bind(
        command.intent,
        runId ?? null,
        JSON.stringify(command),
        new Date().toISOString(),
        requestId
      )
      .run();
  }

  async findByRunId(runId: string): Promise<Correlation | null> {
    const row = await this.db
      .prepare('SELECT * FROM correlations WHERE run_id = ?')
      .bind(runId)
      .first<Record<string, unknown>>();
    return row ? rowToCorrelation(row) : null;
  }

  async findByRequestId(requestId: string): Promise<Correlation | null> {
    const row = await this.db
      .prepare('SELECT * FROM correlations WHERE request_id = ?')
      .bind(requestId)
      .first<Record<string, unknown>>();
    return row ? rowToCorrelation(row) : null;
  }

  async markCompleted(
    requestId: string,
    status: string,
    responseTs?: string,
    lastError?: string
  ): Promise<void> {
    let statement: D1PreparedStatement;
    if (responseTs) {
      statement = this.db
        .prepare(
          `UPDATE correlations
           SET status = ?, response_ts = ?, last_error = ?, updated_at = ?
           WHERE request_id = ?`
        )
        .bind(status, responseTs, lastError ?? null, new Date().toISOString(), requestId);
    } else {
      statement = this.db
        .prepare(
          `UPDATE correlations SET status = ?, last_error = ?, updated_at = ? WHERE request_id = ?`
        )
        .bind(status, lastError ?? null, new Date().toISOString(), requestId);
    }
    await statement.run();
  }
}
