import { describe, expect, it } from 'vitest';
import { createControlPlaneRedactor } from './privacy.js';

describe('control-plane privacy redaction', () => {
  it('redacts secrets, tokens, cookies, sensitive headers, configured PII, and target data', () => {
    const redact = createControlPlaneRedactor({
      sensitiveValues: ['xoxb-secret', 'customer-42'],
      configuredPatterns: ['employee-[0-9]+']
    });
    const value = [
      'Authorization: Bearer abc.def',
      'Cookie: session=top-secret; theme=dark',
      'x-api-key: key-123',
      'email alex@example.test',
      'token=token-456',
      'bot xoxb-secret',
      'target customer-42',
      'employee-1234'
    ].join('\n');

    const result = redact(value);

    expect(result).not.toMatch(
      /abc\.def|top-secret|key-123|alex@example\.test|token-456|xoxb-secret|customer-42|employee-1234/
    );
    expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it('fails closed when a configured pattern is invalid', () => {
    expect(() =>
      createControlPlaneRedactor({ sensitiveValues: [], configuredPatterns: ['[invalid'] })
    ).toThrow('Invalid redaction pattern');
  });
});
