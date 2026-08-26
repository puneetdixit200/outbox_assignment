import { describe, expect, it } from 'vitest';
import { campaignHourKey, hourKey, nextHour, nextSpacingSlot } from './rateLimitPolicy.js';

describe('distributed limiter time boundaries', () => {
  const instant = new Date('2026-08-26T09:42:15.000Z');

  it('uses stable UTC hour keys for sender and campaign quotas', () => {
    expect(hourKey('sender-1', instant)).toBe('outbox:rate:sender:sender-1:2026-08-26T09');
    expect(campaignHourKey('campaign-1', instant)).toBe('outbox:rate:campaign:campaign-1:2026-08-26T09');
  });

  it('defers exactly to the next UTC hour', () => {
    expect(nextHour(instant).toISOString()).toBe('2026-08-26T10:00:00.000Z');
  });

  it('chooses now when the sender is free and the future reservation otherwise', () => {
    expect(nextSpacingSlot(1_000, 1_200)).toBe(1_200);
    expect(nextSpacingSlot(1_700, 1_200)).toBe(1_700);
  });
});
