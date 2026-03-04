/**
 * Unit tests for the API client layer (api.ts).
 * Mocks global fetch to verify requests are constructed correctly
 * and errors are propagated with the right shape.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { liftCoachApi, authApi, historyApi, paymentsApi } from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(data: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => data,
    })
  );
}

afterEach(() => vi.restoreAllMocks());

// ─── liftCoachApi ─────────────────────────────────────────────────────────────

describe('liftCoachApi.getLifts', () => {
  it('calls GET /lifts and returns data', async () => {
    const lifts = [{ id: 'flat_bench_press', name: 'Flat Bench Press' }];
    mockFetch(lifts);

    const result = await liftCoachApi.getLifts();
    expect(result).toEqual(lifts);

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/lifts');
    expect(opts?.method).toBeUndefined(); // defaults to GET
    expect(opts?.credentials).toBe('include');
  });
});

describe('liftCoachApi.createSession', () => {
  it('calls POST /sessions with correct body', async () => {
    mockFetch({ session: { id: 's1', selectedLift: 'deadlift' } });

    await liftCoachApi.createSession({ selectedLift: 'deadlift', goal: 'strength_peak' });

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/sessions');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.selectedLift).toBe('deadlift');
    expect(body.goal).toBe('strength_peak');
  });
});

describe('liftCoachApi.addSnapshots', () => {
  it('calls POST /sessions/:id/snapshots with snapshot array', async () => {
    mockFetch({ ok: true });

    const snapshots = [
      { exerciseId: 'deadlift', weight: 405, sets: 3, reps: 5, weightUnit: 'lbs' },
    ];
    await liftCoachApi.addSnapshots('session_123', snapshots);

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/sessions/session_123/snapshots');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0].exerciseId).toBe('deadlift');
  });
});

describe('liftCoachApi.sendMessage', () => {
  it('calls POST /sessions/:id/messages with message body', async () => {
    mockFetch({ message: 'How does it feel?', complete: false });

    await liftCoachApi.sendMessage('s1', 'It feels hard at lockout');

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/sessions/s1/messages');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.message).toBe('It feels hard at lockout');
  });
});

describe('liftCoachApi.generatePlan', () => {
  it('calls POST /sessions/:id/generate', async () => {
    mockFetch({ plan: { selected_lift: 'deadlift' } });

    await liftCoachApi.generatePlan('s1');

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/sessions/s1/generate');
    expect(opts.method).toBe('POST');
  });
});

describe('API error handling', () => {
  it('throws with status and message on non-OK response', async () => {
    mockFetch({ error: 'Daily analysis limit reached', upgradeUrl: 'https://stripe.com' }, 429);

    let err: any;
    try {
      await liftCoachApi.generatePlan('s1');
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect(err.message).toContain('Daily analysis limit reached');
    expect(err.status).toBe(429);
    expect(err.upgradeUrl).toBe('https://stripe.com');
  });

  it('throws with generic message when error body is unparseable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => { throw new Error('not json'); },
      })
    );

    let err: any;
    try {
      await liftCoachApi.getLifts();
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect(err.status).toBe(500);
  });
});

// ─── authApi ──────────────────────────────────────────────────────────────────

describe('authApi.login', () => {
  it('calls POST /auth/login with email and password', async () => {
    mockFetch({ user: { id: 'u1', email: 'test@example.com', tier: 'free' } });

    await authApi.login('test@example.com', 'pass123');

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/auth/login');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.email).toBe('test@example.com');
    expect(body.password).toBe('pass123');
  });
});

describe('authApi.register', () => {
  it('calls POST /auth/register with name, email, password', async () => {
    mockFetch({ user: { id: 'u2', email: 'new@example.com', tier: 'free' } });

    await authApi.register('New User', 'new@example.com', 'password123');

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/auth/register');
    const body = JSON.parse(opts.body);
    expect(body.name).toBe('New User');
    expect(body.email).toBe('new@example.com');
    expect(body.password).toBe('password123');
  });

  it('includes dateOfBirth when provided', async () => {
    mockFetch({ user: { id: 'u3', email: 'dob@example.com', tier: 'free' } });

    await authApi.register('DOB User', 'dob@example.com', 'password123', '1990-01-01');

    const [, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.dateOfBirth).toBe('1990-01-01');
  });
});

describe('authApi.logout', () => {
  it('calls POST /auth/logout', async () => {
    mockFetch({ success: true });

    await authApi.logout();

    const [url, opts] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/auth/logout');
    expect(opts.method).toBe('POST');
  });
});

// ─── historyApi ───────────────────────────────────────────────────────────────

describe('historyApi.getHistory', () => {
  it('calls GET /sessions/history and returns array', async () => {
    const sessions = [{ id: 's1', selectedLift: 'deadlift', status: 'completed' }];
    mockFetch(sessions);

    const result = await historyApi.getHistory();
    expect(result).toEqual(sessions);
    const [url] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/sessions/history');
  });
});

// ─── paymentsApi ─────────────────────────────────────────────────────────────

describe('paymentsApi.getStatus', () => {
  it('calls GET /payments/status', async () => {
    mockFetch({ tier: 'free' });

    const result = await paymentsApi.getStatus();
    expect(result.tier).toBe('free');
    const [url] = (vi.mocked(fetch) as any).mock.calls[0];
    expect(url).toContain('/payments/status');
  });
});
