export const CONTROL_PLANE_DEFAULTS = {
  workerName: 'qali-slack-control',
  d1DatabaseName: 'qali-control',
  queueName: 'qali-inbound',
  placeholderDatabaseId: 'replace-with-production-database-id',
  placeholderWorkerBaseUrl: 'https://qali-slack-control.example.workers.dev'
} as const;

export interface SlackAppManifest {
  display_information: {
    name: string;
    description: string;
    background_color: string;
  };
  features: {
    bot_user: {
      display_name: string;
      always_online: boolean;
    };
  };
  oauth_config: {
    scopes: {
      bot: string[];
    };
  };
  settings: {
    event_subscriptions: {
      request_url: string;
      bot_events: string[];
    };
    interactivity: {
      is_enabled: boolean;
      request_url: string;
    };
    org_deploy_enabled: boolean;
    socket_mode_enabled: boolean;
    token_rotation_enabled: boolean;
  };
}

export function normalizeWorkerBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error(`Worker base URL must be https: ${baseUrl}`);
  }
  return trimmed;
}

export function renderSlackAppManifest(workerBaseUrl: string): SlackAppManifest {
  const base = normalizeWorkerBaseUrl(workerBaseUrl);
  return {
    display_information: {
      name: 'Qali',
      description:
        'Slack-first autonomous QA agent. Ask Qali to test features, explore your app, generate/run test suits or report quality status',
      background_color: '#ff0084'
    },
    features: {
      bot_user: {
        display_name: 'Qali',
        always_online: true
      }
    },
    oauth_config: {
      scopes: {
        bot: ['app_mentions:read', 'chat:write', 'im:history', 'im:write']
      }
    },
    settings: {
      event_subscriptions: {
        request_url: `${base}/slack/events`,
        bot_events: ['app_mention', 'message.im']
      },
      interactivity: {
        is_enabled: true,
        request_url: `${base}/slack/interactions`
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false
    }
  };
}

/** Keep branding/scopes from the committed template; only substitute Worker URLs. */
export function applyWorkerUrlsToSlackManifest(
  template: SlackAppManifest,
  workerBaseUrl: string
): SlackAppManifest {
  const base = normalizeWorkerBaseUrl(workerBaseUrl);
  return {
    ...template,
    settings: {
      ...template.settings,
      event_subscriptions: {
        ...template.settings.event_subscriptions,
        request_url: `${base}/slack/events`
      },
      interactivity: {
        ...template.settings.interactivity,
        is_enabled: true,
        request_url: `${base}/slack/interactions`
      }
    }
  };
}

export function patchWranglerDatabaseId(configText: string, databaseId: string): string {
  if (!databaseId.trim()) throw new Error('databaseId is required');
  if (!configText.includes('"database_id"')) {
    throw new Error('wrangler config is missing a database_id field');
  }
  return configText.replace(/("database_id"\s*:\s*")([^"]*)(")/, `$1${databaseId.trim()}$3`);
}

export function resolveWorkerBaseUrl(input: { override?: string }): string {
  if (!input.override?.trim()) {
    throw new Error('Provide WORKER_BASE_URL');
  }
  return normalizeWorkerBaseUrl(input.override);
}

export function parseD1CreateOutput(output: string): string | undefined {
  const uuid = output.match(
    /(?:database[_\s-]?id|id)\s*[:=]\s*"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"?/i
  );
  return uuid?.[1];
}
