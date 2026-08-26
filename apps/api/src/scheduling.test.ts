import { describe, expect, it } from 'vitest';
import { normalizeRecipients, scheduledAt } from './scheduling.js';

describe('schedule contract', () => {
  it('normalizes and deduplicates recipient input', () => {
    expect(normalizeRecipients([' A@EXAMPLE.TEST ', 'b@example.test', 'a@example.test'])).toEqual(['a@example.test', 'b@example.test']);
  });
  it('places the first recipient at the requested start instant', () => {
    const start = new Date('2026-08-26T10:00:00.000Z');
    expect(scheduledAt(start, 1, 1000).toISOString()).toBe(start.toISOString());
    expect(scheduledAt(start, 2, 1000).toISOString()).toBe('2026-08-26T10:00:01.000Z');
  });
});
