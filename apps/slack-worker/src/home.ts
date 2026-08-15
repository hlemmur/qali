import type { Correlation } from './types.js';

export type HomeSection = 'needs-attention' | 'running' | 'recent';

export interface HomeItem {
  requestId: string;
  status: string;
  intent?: string;
  projectId?: string;
  updatedAt: string;
}

const NEEDS_ATTENTION = new Set([
  'failed',
  'blocked',
  'dead-lettered',
  'dispatch-uncertain',
  'rejected'
]);
const RUNNING = new Set(['queued', 'processing', 'dispatched']);

export function classifyHomeSection(status: string): HomeSection {
  if (NEEDS_ATTENTION.has(status)) return 'needs-attention';
  if (RUNNING.has(status)) return 'running';
  return 'recent';
}

export function homeItemsFromCorrelations(rows: readonly Correlation[]): HomeItem[] {
  return rows.map((row) => {
    let projectId: string | undefined;
    let intent = row.workflowId;
    if (row.commandJson) {
      try {
        const parsed = JSON.parse(row.commandJson) as {
          intent?: unknown;
          project?: { id?: unknown };
        };
        if (typeof parsed.intent === 'string') intent = parsed.intent;
        if (typeof parsed.project?.id === 'string') projectId = parsed.project.id;
      } catch {
        // Keep correlation fields when stored JSON is unusable.
      }
    }
    return {
      requestId: row.requestId,
      status: row.status,
      ...(intent ? { intent } : {}),
      ...(projectId ? { projectId } : {}),
      updatedAt: row.updatedAt
    };
  });
}

function sectionBlocks(title: string, items: HomeItem[]) {
  const lines =
    items.length === 0
      ? '_None._'
      : items
          .slice(0, 8)
          .map((item) => {
            const label = [item.projectId, item.intent, item.status].filter(Boolean).join(' · ');
            return `• ${label || item.requestId}`;
          })
          .join('\n');
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: true }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines }
    }
  ];
}

export function renderAppHome(items: readonly HomeItem[]): {
  type: 'home';
  blocks: Array<Record<string, unknown>>;
} {
  const grouped: Record<HomeSection, HomeItem[]> = {
    'needs-attention': [],
    running: [],
    recent: []
  };
  for (const item of items) {
    grouped[classifyHomeSection(item.status)].push(item);
  }
  return {
    type: 'home',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Your QA control room. Channels stay the team surface; this tab is personal.'
        }
      },
      ...sectionBlocks('Needs attention', grouped['needs-attention']),
      ...sectionBlocks('Running', grouped.running),
      ...sectionBlocks('Recent', grouped.recent),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Try in the product channel:* `@Qali explore the login flow` · `@Qali run the smoke suite` · `@Qali what is our quality status?`'
        }
      }
    ]
  };
}
