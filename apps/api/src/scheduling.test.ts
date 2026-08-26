import { describe, expect, it } from 'vitest';
import { effectiveDelay, normalizeRecipients, scheduledAt } from './scheduling.js';

describe('schedule contract', () => {
  it('normalizes and deduplicates recipient input', () => {
    expect(normalizeRecipients([' A@EXAMPLE.TEST ', 'b@example.test', 'a@example.test'])).toEqual(['a@example.test', 'b@example.test']);
  });

  it('enforces the configured provider-delay floor', () => {
    expect(effectiveDelay(undefined, 1000)).toBe(1000);
    expect(effectiveDelay(100, 1000)).toBe(1000);
    expect(effectiveDelay(2500, 1000)).toBe(2500);
  });

  it('places the first recipient at the requested start instant', () => {
    const start = new Date('2026-08-26T10:00:00.000Z');
    expect(scheduledAt(start, 1, 1000).toISOString()).toBe(start.toISOString());
    expect(scheduledAt(start, 2, 1000).toISOString()).toBe('2026-08-26T10:00:01.000Z');
  });
});
