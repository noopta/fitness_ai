import { describe, it, expect, vi, beforeEach } from 'vitest';

// Log review + away card ship behind LOG_REVIEW_* / AWAY_DIGEST_* (Oct 2026):
// on for the allowlist only, off for everyone else.
describe('log review flags', () => {
  beforeEach(() => { vi.resetModules(); });

  it('is off by default and on for an allowlisted email or id', async () => {
    process.env.LOG_REVIEW_USERS = 'Tester@Example.com, u-2';
    process.env.AWAY_DIGEST_USERS = 'tester@example.com';
    delete process.env.LOG_REVIEW_ENABLED; delete process.env.AWAY_DIGEST_ENABLED;
    const f = await import('../services/featureFlags.js');
    expect(f.logReviewAvailableFor('u-1', 'tester@example.com')).toBe(true);
    expect(f.logReviewAvailableFor('u-2', null)).toBe(true);
    expect(f.logReviewAvailableFor('u-3', 'someone@else.com')).toBe(false);
    expect(f.awayDigestAvailableFor('u-1', 'TESTER@example.com')).toBe(true);
    expect(f.awayDigestAvailableFor('u-2', null)).toBe(false);
  });

  it('the global switch turns it on for everyone', async () => {
    process.env.LOG_REVIEW_ENABLED = '1'; process.env.LOG_REVIEW_USERS = '';
    const f = await import('../services/featureFlags.js');
    expect(f.logReviewAvailableFor('anyone', null)).toBe(true);
    delete process.env.LOG_REVIEW_ENABLED;
  });
});
