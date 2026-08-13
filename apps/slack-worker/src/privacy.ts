export interface RedactionConfig {
  sensitiveValues: Array<string | undefined>;
  configuredPatterns: string[];
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createControlPlaneRedactor(config: RedactionConfig): (value: string) => string {
  let configured: RegExp[];
  try {
    configured = config.configuredPatterns.map((pattern) => new RegExp(pattern, 'gi'));
  } catch (error) {
    throw new Error('Invalid redaction pattern', { cause: error });
  }
  const exact = config.sensitiveValues
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .map((value) => new RegExp(escapeRegex(value), 'g'));
  const builtIn = [
    /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*[:=]\s*[^\r\n]+/gi,
    /\bBearer\s+[A-Za-z0-9._~+/-]+/gi,
    /\b(?:access[_-]?token|api[_-]?key|client[_-]?secret|password|refresh[_-]?token|token)\s*[:=]\s*["']?[^\s,"'};]+/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  ];
  const patterns = [...exact, ...configured, ...builtIn];
  return (value: string): string =>
    patterns
      .reduce((output, pattern) => output.replace(pattern, '[REDACTED]'), value)
      .slice(0, 4_000);
}
