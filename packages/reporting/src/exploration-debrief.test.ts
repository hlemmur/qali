import { describe, expect, it } from 'vitest';
import { parseExplorationDebrief, renderMarkdownToHtml } from './exploration-debrief.js';

const sample = `# Exploration Report — sauce-demo

Session focus: **app** (login → inventory)

## What ran

Run status: **truncated**. Login shell was reached; authenticated flows never started because fill tools timed out.

## Findings

**Observed (live this session)**

- Login page loads at origin with expected fields and Login control.
- Direct navigation to \`/inventory.html\` without auth redirects to login.

## Open questions

| ID | Question |
| --- | --- |
| Q-EXP-001 | Exact error copy for invalid credentials |
| Q-EXP-004 | Do login controls match JRN-001 locator roles? |

## Next actions

1. **Harness fix first** — align fill strategy with placeholder fields.
2. **Re-run explore** — execute happy path login.
3. **Test generation** — do **not** generate regression for cart yet.
`;

describe('exploration debrief', () => {
  it('extracts the human verdict, findings, questions, and next actions', () => {
    const parsed = parseExplorationDebrief(sample);
    expect(parsed.truncated).toBe(true);
    expect(parsed.verdict).toMatch(/Login shell was reached/i);
    expect(parsed.findings.some((item) => /Login page loads/i.test(item))).toBe(true);
    expect(parsed.questions.some((item) => /invalid credentials/i.test(item))).toBe(true);
    expect(parsed.nextActions[0]).toMatch(/Harness fix first/i);
    expect(parsed.debriefMarkdown).not.toMatch(/qali:generated/);
  });

  it('renders the debrief as HTML without harness skill names', () => {
    const html = renderMarkdownToHtml(sample);
    expect(html).toContain('<h2>Findings</h2>');
    expect(html).toContain('Login page loads');
    expect(html).toContain('<table>');
    expect(html).toContain('Q-EXP-001');
    expect(html).not.toContain('browser-exploration');
    expect(html).not.toContain('<script');
  });
});
