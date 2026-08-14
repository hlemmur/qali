import type { ClassifiedIntent } from '@qali/contracts';

const KNOWN_HOSTS: Record<string, string> = {
  'saucedemo.com': 'sauce-demo'
};

const CREDENTIAL_TOKEN = /\b(?:user(?:name)?|password|credential(?:name)?|creds?)\s*[:=]\s*\S+/gi;

export interface OnboardCredentials {
  name: string;
  username?: string;
  password: string;
}

export type ParsedOnboardTarget =
  | {
      ok: true;
      targetUrl: string;
      origin: string;
      projectId: string;
      sanitizedText: string;
      credentials?: OnboardCredentials;
    }
  | { ok: false; reason: string };

function unwrapSlackUrl(raw: string): string {
  const wrapped = raw.match(/^<([^|>]+)(?:\|[^>]+)?>$/);
  return wrapped?.[1] ?? raw;
}

function firstCandidateUrl(text: string): string | undefined {
  const match = text.match(
    /<https?:\/\/[^>\s]+>|https?:\/\/[^\s>]+|javascript:[^\s>]+|[a-z][a-z0-9+.-]*:\/\/[^\s>]+/i
  );
  return match?.[0] ? unwrapSlackUrl(match[0]) : undefined;
}

export function projectSlugFromHostname(hostname: string): string {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  return KNOWN_HOSTS[host] ?? host.replaceAll('.', '-').replace(/[^a-z0-9-]+/g, '-');
}

function namedValue(text: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = text.match(new RegExp(`\\b${name}\\s*[:=]\\s*(\\S+)`, 'i'));
    if (match?.[1]) return match[1].replace(/^[<'"]+|[>'",.]+$/g, '');
  }
  return undefined;
}

function sanitizeOnboardText(text: string): string {
  return text.replace(CREDENTIAL_TOKEN, '').replace(/\s+/g, ' ').trim();
}

export function parseOnboardTarget(text: string): ParsedOnboardTarget {
  const candidate = firstCandidateUrl(text);
  if (!candidate) return { ok: false, reason: 'no-target-url' };
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'Target URL must be http or https' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Target URL must be http or https' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Target URLs cannot contain credentials' };
  }
  const password = namedValue(text, ['password']);
  const username = namedValue(text, ['username', 'user']);
  const credentialName = namedValue(text, ['credentialname', 'credential', 'creds']) ?? 'password';
  return {
    ok: true,
    targetUrl: parsed.toString(),
    origin: parsed.origin,
    projectId: projectSlugFromHostname(parsed.hostname),
    sanitizedText: sanitizeOnboardText(text),
    ...(password
      ? {
          credentials: {
            name: credentialName,
            ...(username ? { username } : {}),
            password
          }
        }
      : {})
  };
}

export function applyOnboardTarget(
  classification: ClassifiedIntent,
  text: string
): ClassifiedIntent {
  if (classification.intent !== 'onboard-project') return classification;
  const parsed = parseOnboardTarget(text);
  if (!parsed.ok) {
    if (parsed.reason === 'no-target-url') return classification;
    throw new Error(parsed.reason);
  }
  return {
    ...classification,
    projectId: parsed.projectId,
    focus: {
      ...classification.focus,
      targetUrl: parsed.targetUrl,
      origin: parsed.origin
    }
  };
}
