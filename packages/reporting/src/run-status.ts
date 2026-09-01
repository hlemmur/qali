export function displayRunStatus(summary: {
  status: string;
  conclusion?: string;
  exploration?: { truncated?: boolean };
}): string {
  if (summary.exploration?.truncated) return 'incomplete';
  const raw = (summary.conclusion ?? summary.status).toLowerCase();
  if (raw === 'success' || raw === 'passed') return 'passed';
  if (raw === 'failure' || raw === 'failed') return 'failed';
  if (raw === 'blocked') return 'blocked';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (raw === 'timed_out') return 'timed out';
  return summary.conclusion ?? summary.status;
}

/** True when the run has finished (success, failure, cancelled, etc.). */
export function isTerminalRunStatus(summary: { status: string; conclusion?: string }): boolean {
  if (summary.conclusion) return true;
  const status = summary.status.toLowerCase();
  return !['queued', 'waiting', 'requested', 'pending', 'in_progress', 'running'].includes(status);
}
