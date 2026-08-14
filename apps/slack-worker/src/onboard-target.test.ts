import { describe, expect, it } from 'vitest';
import {
  applyOnboardTarget,
  parseOnboardTarget,
  projectSlugFromHostname
} from './onboard-target.js';

describe('onboard target parsing', () => {
  it('classifies an https onboard URL and maps the live Sauce Demo host', () => {
    const parsed = parseOnboardTarget('@Qali onboard https://www.saucedemo.com');
    expect(parsed).toMatchObject({
      ok: true,
      targetUrl: 'https://www.saucedemo.com/',
      projectId: 'sauce-demo',
      origin: 'https://www.saucedemo.com'
    });
    if (parsed.ok) expect(parsed.credentials).toBeUndefined();
  });

  it('derives a hostname slug for a new https origin', () => {
    expect(projectSlugFromHostname('www.example.com')).toBe('example-com');
    expect(parseOnboardTarget('onboard https://example.com/inventory')).toMatchObject({
      ok: true,
      projectId: 'example-com',
      targetUrl: 'https://example.com/inventory',
      origin: 'https://example.com'
    });
  });

  it('rejects javascript and non-http onboard URLs', () => {
    expect(parseOnboardTarget('onboard javascript:alert(1)')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/http or https/i)
    });
    expect(parseOnboardTarget('onboard ftp://files.example.com')).toMatchObject({ ok: false });
    expect(parseOnboardTarget('onboard project sauce-demo').ok).toBe(false);
  });

  it('captures optional named credentials without leaving them in sanitized text', () => {
    const parsed = parseOnboardTarget(
      '@Qali onboard https://www.saucedemo.com username=standard_user password=secret_sauce credential=password'
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.credentials).toEqual({
      name: 'password',
      username: 'standard_user',
      password: 'secret_sauce'
    });
    expect(parsed.sanitizedText).toBe('@Qali onboard https://www.saucedemo.com');
    expect(parsed.sanitizedText).not.toContain('secret_sauce');
    expect(parsed.sanitizedText).not.toContain('standard_user');
  });

  it('overlays a classified onboard intent with the parsed https target', () => {
    expect(
      applyOnboardTarget(
        {
          intent: 'onboard-project',
          projectId: 'sauce-demo',
          focus: { classification: 'heuristic-fallback' }
        },
        '@Qali onboard https://www.saucedemo.com'
      )
    ).toEqual({
      intent: 'onboard-project',
      projectId: 'sauce-demo',
      focus: {
        classification: 'heuristic-fallback',
        targetUrl: 'https://www.saucedemo.com/',
        origin: 'https://www.saucedemo.com'
      }
    });
  });
});
