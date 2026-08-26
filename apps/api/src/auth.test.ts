import { describe, expect, it } from 'vitest';
import { createOAuthState } from './auth.js';

describe('OAuth state contract', () => {
  it('creates unpredictable URL-safe state values', () => {
    const first = createOAuthState(); const second = createOAuthState();
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/); expect(first.length).toBeGreaterThanOrEqual(32); expect(second).not.toBe(first);
  });
});
