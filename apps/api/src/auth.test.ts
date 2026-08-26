import { describe, expect, it } from 'vitest';
import { createOAuthState, isValidDevCredential } from './auth.js';

describe('OAuth state contract', () => {
  it('creates unpredictable URL-safe state values', () => {
    const first = createOAuthState(); const second = createOAuthState();
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/); expect(first.length).toBeGreaterThanOrEqual(32); expect(second).not.toBe(first);
  });
});

describe('development password login contract', () => {
  it('accepts only the configured email and password', () => {
    expect(isValidDevCredential('demo@outbox.local', 'outbox-local-demo', 'demo@outbox.local', 'outbox-local-demo')).toBe(true);
    expect(isValidDevCredential('demo@outbox.local', 'wrong-password', 'demo@outbox.local', 'outbox-local-demo')).toBe(false);
    expect(isValidDevCredential('other@example.com', 'outbox-local-demo', 'demo@outbox.local', 'outbox-local-demo')).toBe(false);
  });
});
