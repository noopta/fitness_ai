// Regression tests for the OAuth open-redirect fix.
//
// The vulnerability: /api/auth/google took `redirect_uri` from the query
// string, carried it through the OAuth round-trip inside `state`, and the
// callback appended a 30-day JWT to it and 302'd. With no allowlist,
// `?redirect_uri=https://evil.tld` meant the victim saw the genuine Google
// consent screen for the genuine Axiom app, approved it, and their token was
// delivered to the attacker's host. Full account takeover from one link.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = {};
  }),
}));
vi.mock('twilio', () => ({ default: vi.fn(() => ({ messages: { create: vi.fn() } })) }));
vi.mock('apple-signin-auth', () => ({ default: { verifyIdToken: vi.fn() } }));

async function loadWithEnv(nodeEnv: string) {
  vi.resetModules();
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = 'test-secret';
  return import('../routes/auth.js');
}

describe('isAllowedRedirectTarget (production)', () => {
  let isAllowedRedirectTarget: (t: string | null | undefined) => boolean;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    ({ isAllowedRedirectTarget } = await loadWithEnv('production'));
  });
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it('allows the app custom schemes we actually register', () => {
    expect(isAllowedRedirectTarget('axiom://auth/callback')).toBe(true);
    expect(isAllowedRedirectTarget('com.clubscentra.app://auth')).toBe(true);
  });

  it('allows our own https hosts', () => {
    expect(isAllowedRedirectTarget('https://axiomtraining.io/login')).toBe(true);
    expect(isAllowedRedirectTarget('https://www.axiomtraining.io')).toBe(true);
    expect(isAllowedRedirectTarget('https://liftoffmvp.io')).toBe(true);
  });

  it('allows Replit preview and deploy domains', () => {
    expect(isAllowedRedirectTarget('https://something.replit.app')).toBe(true);
    expect(isAllowedRedirectTarget('https://x-y-z.replit.dev')).toBe(true);
  });

  // ── The attack cases ──────────────────────────────────────────────────────

  it('rejects an arbitrary attacker host — the core vulnerability', () => {
    expect(isAllowedRedirectTarget('https://evil.tld')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.tld/collect?x=1')).toBe(false);
  });

  it('rejects a suffix-confusion host', () => {
    // Substring matching would have accepted this; URL parsing is what stops it.
    expect(isAllowedRedirectTarget('https://axiomtraining.io.evil.tld')).toBe(false);
    expect(isAllowedRedirectTarget('https://notaxiomtraining.io')).toBe(false);
  });

  it('rejects an allowlisted host smuggled into userinfo, path, query or fragment', () => {
    expect(isAllowedRedirectTarget('https://axiomtraining.io@evil.tld')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.tld/axiomtraining.io')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.tld?x=axiomtraining.io')).toBe(false);
    expect(isAllowedRedirectTarget('https://evil.tld#axiomtraining.io')).toBe(false);
  });

  it('rejects a fake Replit suffix', () => {
    expect(isAllowedRedirectTarget('https://notreplit.app')).toBe(false);
    expect(isAllowedRedirectTarget('https://replit.app.evil.tld')).toBe(false);
  });

  it('rejects an unregistered custom scheme', () => {
    expect(isAllowedRedirectTarget('evil://steal')).toBe(false);
    expect(isAllowedRedirectTarget('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectTarget('data:text/html,<script>')).toBe(false);
  });

  it('rejects plaintext http in production', () => {
    expect(isAllowedRedirectTarget('http://axiomtraining.io')).toBe(false);
  });

  it('rejects the exp:// dev scheme in production', () => {
    expect(isAllowedRedirectTarget('exp://192.168.1.5:8081')).toBe(false);
  });

  it('rejects empty and malformed input', () => {
    expect(isAllowedRedirectTarget(null)).toBe(false);
    expect(isAllowedRedirectTarget(undefined)).toBe(false);
    expect(isAllowedRedirectTarget('')).toBe(false);
    expect(isAllowedRedirectTarget('not a url at all')).toBe(false);
  });
});

describe('isAllowedRedirectTarget (development)', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it('permits localhost http and the Expo scheme outside production', async () => {
    const { isAllowedRedirectTarget } = await loadWithEnv('development');
    expect(isAllowedRedirectTarget('http://localhost:5173/login')).toBe(true);
    expect(isAllowedRedirectTarget('exp://192.168.1.5:8081')).toBe(true);
    // Still no free pass for arbitrary hosts, even in dev.
    expect(isAllowedRedirectTarget('https://evil.tld')).toBe(false);
  });
});

describe('safeRedirectTarget', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it('passes through an allowed target and nulls a rejected one', async () => {
    const { safeRedirectTarget } = await loadWithEnv('production');
    expect(safeRedirectTarget('axiom://auth/callback')).toBe('axiom://auth/callback');
    expect(safeRedirectTarget('https://evil.tld')).toBeNull();
  });
});
