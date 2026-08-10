import { describe, expect, it } from 'vitest';
import { QALI_VERSION } from './index.js';

describe('Qali workspace', () => {
  it('exposes its runtime contract version', () => {
    expect(QALI_VERSION).toBe('0.1.0');
  });
});
