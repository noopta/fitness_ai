import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { rateLimit } from '../middleware/rateLimiter.js';

// vitest.config sets RATE_LIMIT_DISABLED=true so route tests aren't throttled.
// This suite is the one place that wants the limiter actually enforcing.
const originalDisabled = process.env.RATE_LIMIT_DISABLED;
beforeAll(() => { process.env.RATE_LIMIT_DISABLED = 'false'; });
afterAll(() => { process.env.RATE_LIMIT_DISABLED = originalDisabled; });

function mockReqRes(overrides: Record<string, any> = {}) {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    _finishHandlers: [] as Array<() => void>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
    on(event: string, cb: () => void) { if (event === 'finish') this._finishHandlers.push(cb); },
    finish() { this._finishHandlers.forEach((cb) => cb()); },
  };
  const req: any = { ip: '1.2.3.4', user: undefined, ...overrides };
  return { req, res };
}

describe('rateLimit', () => {
  it('allows requests up to the limit and blocks the next one', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const { req, res } = mockReqRes();
      limiter(req, res, next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    const { req, res } = mockReqRes();
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(3); // not called again
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
  });

  it('keys separate IPs into separate buckets', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();

    const a = mockReqRes({ ip: '1.1.1.1' });
    limiter(a.req, a.res, next);
    const b = mockReqRes({ ip: '2.2.2.2' });
    limiter(b.req, b.res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(b.res.statusCode).toBe(200);
  });

  it('keys on user id when authenticated, so one user cannot exhaust a shared IP', () => {
    // Two users behind the same NAT must not share a bucket.
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();

    const a = mockReqRes({ ip: '1.1.1.1', user: { id: 'user-a' } });
    limiter(a.req, a.res, next);
    const b = mockReqRes({ ip: '1.1.1.1', user: { id: 'user-b' } });
    limiter(b.req, b.res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(b.res.statusCode).toBe(200);
  });

  it('expires entries once the window passes', () => {
    vi.useFakeTimers();
    try {
      const limiter = rateLimit({ windowMs: 1000, max: 1 });
      const next = vi.fn();

      const first = mockReqRes();
      limiter(first.req, first.res, next);

      const blocked = mockReqRes();
      limiter(blocked.req, blocked.res, next);
      expect(blocked.res.statusCode).toBe(429);

      vi.advanceTimersByTime(1001);

      const after = mockReqRes();
      limiter(after.req, after.res, next);
      expect(after.res.statusCode).toBe(200);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('skipSuccessful (credential endpoints)', () => {
    it('does not penalise successful logins', () => {
      const limiter = rateLimit({ windowMs: 60_000, max: 2, skipSuccessful: true });
      const next = vi.fn();

      // Five successes in a row — a user who genuinely signs in repeatedly.
      for (let i = 0; i < 5; i++) {
        const { req, res } = mockReqRes();
        limiter(req, res, next);
        res.statusCode = 200;
        res.finish();
      }
      expect(next).toHaveBeenCalledTimes(5);
    });

    it('still counts failed attempts, which is what a brute-forcer produces', () => {
      const limiter = rateLimit({ windowMs: 60_000, max: 2, skipSuccessful: true });
      const next = vi.fn();

      for (let i = 0; i < 2; i++) {
        const { req, res } = mockReqRes();
        limiter(req, res, next);
        res.statusCode = 401;
        res.finish();
      }
      expect(next).toHaveBeenCalledTimes(2);

      const third = mockReqRes();
      limiter(third.req, third.res, next);
      expect(third.res.statusCode).toBe(429);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  it('honours a custom key function', () => {
    const limiter = rateLimit({
      windowMs: 60_000,
      max: 1,
      keyFn: (req: any) => `email:${req.body?.email}`,
    });
    const next = vi.fn();

    const a = mockReqRes({ ip: '1.1.1.1', body: { email: 'a@x.com' } });
    limiter(a.req, a.res, next);
    const b = mockReqRes({ ip: '9.9.9.9', body: { email: 'a@x.com' } });
    limiter(b.req, b.res, next);

    // Same email from a different IP is still the same bucket.
    expect(b.res.statusCode).toBe(429);
  });

  it('returns the configured message', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 0, message: 'slow down' });
    const { req, res } = mockReqRes();
    limiter(req, res, vi.fn());
    expect(res.body.error).toBe('slow down');
  });
});
