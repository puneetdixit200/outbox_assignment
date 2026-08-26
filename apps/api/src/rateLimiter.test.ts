import { describe, expect, it } from 'vitest';
import { hourKey, nextHour, nextSpacingSlot } from './rateLimiter.js';

describe('distributed limiter time boundaries', () => {
  it('uses a stable UTC hour key', () => {
    expect(hourKey('sender-1', new Date('2026-08-26T09:42:15.000Z'))).toBe('outbox:rate:sender-1:2026-08-26T09');
  });
  it('defers exactly to the next UTC hour', () => {
    expect(nextHour(new Date('2026-08-26T09:42:15.000Z')).toISOString()).toBe('2026-08-26T10:00:00.000Z');
  });
  it('assigns concurrent sends distinct future slots', () => {
    expect(nextSpacingSlot(1_000, 1_200, 500)).toBe(1_200);
    expect(nextSpacingSlot(1_700, 1_200, 500)).toBe(1_700);
  });
});
