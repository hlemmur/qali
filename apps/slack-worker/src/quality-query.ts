import { QualitySnapshotSchema, type QualitySnapshot, type QueryTopic } from '@qali/contracts';

export function parseQualitySnapshot(input: unknown): QualitySnapshot | undefined {
  const parsed = QualitySnapshotSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export function mergeQualitySnapshot(
  existing: QualitySnapshot | null | undefined,
  patch: Pick<QualitySnapshot, 'projectId' | 'updatedAt'> & Partial<QualitySnapshot>
): QualitySnapshot {
  return QualitySnapshotSchema.parse({
    version: 1,
    ...existing,
    ...patch,
    lastRun: patch.lastRun ?? existing?.lastRun,
    coverage: patch.coverage ?? existing?.coverage,
    journeys: patch.journeys ?? existing?.journeys,
    openQuestions: patch.openQuestions ?? existing?.openQuestions,
    knownIssues: patch.knownIssues ?? existing?.knownIssues,
    expectedResults: patch.expectedResults ?? existing?.expectedResults,
    schedules: patch.schedules ?? existing?.schedules
  });
}

function topic(focus: Record<string, unknown>): QueryTopic {
  const value = focus.topic;
  if (
    value === 'coverage' ||
    value === 'schedule' ||
    value === 'history' ||
    value === 'expected' ||
    value === 'flows'
  ) {
    return value;
  }
  return 'status';
}

function needle(focus: Record<string, unknown>): string | undefined {
  const value = focus.feature ?? focus.area;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

function matching(items: string[] | undefined, feature?: string): string[] {
  if (!items?.length) return [];
  if (!feature) return items;
  return items.filter((item) => item.toLowerCase().includes(feature));
}

function list(label: string, items: string[], empty: string): string {
  if (!items.length) return empty;
  return `${label}: ${items.slice(0, 5).join('; ')}${items.length > 5 ? '…' : ''}`;
}

function lastRunLine(snapshot: QualitySnapshot): string {
  const run = snapshot.lastRun;
  if (!run) return 'No recorded run yet.';
  const counts = run.counts
    ? `${run.counts.passed} passed, ${run.counts.failed} failed, ${run.counts.skipped} skipped`
    : run.status;
  return `Last ${run.intent} ${run.status} at ${run.finishedAt} (${counts}).`;
}

export function formatQualityQueryAnswer(
  snapshot: QualitySnapshot | null | undefined,
  focus: Record<string, unknown> = {}
): string {
  if (!snapshot) {
    return 'I do not have a recent quality snapshot for this project yet. I can look it up from the project pack without running Playwright, or you can ask me to run the smoke suite.';
  }
  const feature = needle(focus);
  const project = `\`${snapshot.projectId}\``;
  switch (topic(focus)) {
    case 'history':
      return `${project}: ${lastRunLine(snapshot)} ${list(
        'Known issues',
        matching(snapshot.knownIssues, feature),
        'No known issues recorded.'
      )}`;
    case 'coverage': {
      if (!snapshot.coverage) {
        return `${project}: I do not have coverage details yet. ${lastRunLine(snapshot)}`;
      }
      return `${project}: ${snapshot.coverage.automatedTests}/${snapshot.coverage.approvedScenarios} approved scenarios have automated tests (${snapshot.coverage.percent}%).`;
    }
    case 'schedule': {
      const schedules = snapshot.schedules ?? [];
      if (!schedules.length) return `${project}: No schedule is recorded.`;
      return `${project}: ${schedules
        .map(
          (entry) =>
            `${entry.workflowId} at \`${entry.cron}\` (${entry.enabled ? 'enabled' : 'paused'})`
        )
        .join('; ')}.`;
    }
    case 'expected':
      return `${project}: ${list(
        'Expected results',
        matching(snapshot.expectedResults, feature),
        feature
          ? `I do not have a recorded expected result for ${feature}.`
          : 'No expected-result notes are in the snapshot.'
      )}`;
    case 'flows':
      return `${project}: ${list(
        'Critical flows',
        matching(snapshot.journeys, feature),
        'No journeys are recorded.'
      )}`;
    default:
      return [
        `${project} quality snapshot updated ${snapshot.updatedAt}.`,
        lastRunLine(snapshot),
        snapshot.coverage
          ? `Coverage: ${snapshot.coverage.automatedTests}/${snapshot.coverage.approvedScenarios} automated (${snapshot.coverage.percent}%).`
          : undefined,
        list('Open questions', snapshot.openQuestions ?? [], 'No open questions.'),
        snapshot.schedules?.length
          ? `Next scheduled work: ${snapshot.schedules[0]?.workflowId} at \`${snapshot.schedules[0]?.cron}\`.`
          : undefined
      ]
        .filter(Boolean)
        .join(' ');
  }
}
